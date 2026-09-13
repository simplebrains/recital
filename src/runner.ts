/**
 * The runner drives a persistent shell through a parsed document's blocks,
 * matches output against expectations, and threads captured bindings forward.
 */

import {
  matchBlock,
  normalizeOutput,
  substituteBindings,
  type Bindings,
  type NormalizeOptions,
} from "./matcher.js";
import { parseMarkdown, type ParseOptions } from "./parser.js";
import { ShellSession, type ShellOptions } from "./shell.js";
import type {
  Block,
  BlockResult,
  DocumentResult,
  Interaction,
  InteractionResult,
  ParsedDocument,
} from "./types.js";

export interface RunnerOptions extends ShellOptions {
  /** Output normalization options. */
  normalize?: NormalizeOptions;
  /**
   * When true, every command must exit 0 unless its block overrides with an
   * `exit=` fence option. Default false (output is asserted, exit code is not).
   */
  expectSuccess?: boolean;
}

function formatMismatch(
  interaction: Interaction,
  executed: string,
  actual: string[],
  failedAt: number | undefined,
): string {
  const lines: string[] = [];
  lines.push(`Output did not match expectation for command:`);
  lines.push(`  $ ${executed}`);
  if (failedAt !== undefined && interaction.expected[failedAt] !== undefined) {
    lines.push(`First mismatch at expected line ${failedAt + 1}:`);
    lines.push(`  expected: ${JSON.stringify(interaction.expected[failedAt])}`);
  }
  lines.push("--- expected ---");
  lines.push(...interaction.expected.map((l) => "  " + l));
  lines.push("--- actual ---");
  lines.push(...actual.map((l) => "  " + l));
  return lines.join("\n");
}

/**
 * A stateful runner holding one shell session and the document-wide bindings.
 * Callers may run block-by-block (sharing state) or use `runDocument`.
 */
export class Runner {
  readonly session: ShellSession;
  bindings: Bindings = {};
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions = {}) {
    this.options = options;
    this.session = new ShellSession(options);
  }

  private expectedExit(block: Block): number | null {
    if ("exit" in block.options) {
      const n = Number.parseInt(block.options.exit!, 10);
      return Number.isNaN(n) ? null : n;
    }
    return this.options.expectSuccess ? 0 : null;
  }

  /** Run one interaction against the current session and bindings. */
  async runInteraction(
    interaction: Interaction,
    expectedExit: number | null,
  ): Promise<InteractionResult> {
    let executed: string;
    try {
      executed = substituteBindings(interaction.command, this.bindings);
    } catch (err) {
      return {
        interaction,
        executed: interaction.command,
        ok: false,
        exitCode: -1,
        output: "",
        error: (err as Error).message,
      };
    }

    const { output, exitCode } = await this.session.run(executed);
    const actual = normalizeOutput(output, this.options.normalize);

    if (expectedExit !== null && exitCode !== expectedExit) {
      return {
        interaction,
        executed,
        ok: false,
        exitCode,
        output,
        error: `Expected exit code ${expectedExit} but command exited ${exitCode}.\n  $ ${executed}\n--- output ---\n${actual.map((l) => "  " + l).join("\n")}`,
      };
    }

    const match = matchBlock(interaction.expected, actual, this.bindings);
    if (!match.ok) {
      return {
        interaction,
        executed,
        ok: false,
        exitCode,
        output,
        error: formatMismatch(interaction, executed, actual, match.failedAt),
      };
    }

    this.bindings = match.bindings;
    return { interaction, executed, ok: true, exitCode, output };
  }

  /** Run a whole block, stopping at the first failing interaction. */
  async runBlock(block: Block): Promise<BlockResult> {
    const results: InteractionResult[] = [];
    if ("skip" in block.options) {
      return { block, ok: true, interactions: results };
    }
    if (block.options.cwd) {
      await this.session.run(`cd ${JSON.stringify(block.options.cwd)}`);
    }

    const expectedExit = this.expectedExit(block);
    let ok = true;
    for (const interaction of block.interactions) {
      const result = await this.runInteraction(interaction, expectedExit);
      results.push(result);
      if (!result.ok) {
        ok = false;
        break;
      }
    }
    return { block, ok, interactions: results };
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}

/** Parse and run a Markdown source string end-to-end. */
export async function runDocument(
  source: string,
  options: RunnerOptions & ParseOptions = {},
): Promise<DocumentResult> {
  const parsed = parseMarkdown(source, options);
  return runParsedDocument(parsed, options);
}

/** Run an already-parsed document end-to-end with a fresh session. */
export async function runParsedDocument(
  parsed: ParsedDocument,
  options: RunnerOptions = {},
): Promise<DocumentResult> {
  const runner = new Runner(options);
  const blocks: BlockResult[] = [];
  let ok = true;
  try {
    for (const block of parsed.blocks) {
      const result = await runner.runBlock(block);
      blocks.push(result);
      if (!result.ok) ok = false;
    }
  } finally {
    await runner.close();
  }
  return { path: parsed.path, ok, blocks };
}
