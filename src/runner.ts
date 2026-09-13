/**
 * The runner drives persistent shell sessions through a parsed document's
 * blocks, matches output against expectations, and threads captured bindings
 * forward within each session.
 *
 * A document may declare several sessions (one per non-`isolate` directive);
 * blocks are dispatched to the session of the directive that owns them, but are
 * always executed in document order, even when sessions are interleaved.
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
  RecitalDirective,
} from "./types.js";

export interface RunnerOptions extends ShellOptions {
  /** Output normalization options. */
  normalize?: NormalizeOptions;
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
 * A stateful runner holding one shell session and its bindings. Blocks run on
 * it in sequence share working directory, environment, and captured bindings.
 */
export class Runner {
  readonly session: ShellSession;
  bindings: Bindings = {};
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions = {}) {
    this.options = options;
    this.session = new ShellSession(options);
  }

  /** Run one interaction against the current session and bindings. */
  async runInteraction(interaction: Interaction): Promise<InteractionResult> {
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

    // recital asserts output, not exit status; the exit code is informational.
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
    let ok = true;
    for (const interaction of block.interactions) {
      const result = await this.runInteraction(interaction);
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

/**
 * Run an already-parsed document end-to-end. Each non-`isolate` directive gets
 * one persistent session shared by its blocks; `isolate` directives get a fresh
 * session per block. Blocks with no matching directive are skipped.
 */
export async function runParsedDocument(
  parsed: ParsedDocument,
  options: RunnerOptions = {},
): Promise<DocumentResult> {
  const sessions = new Map<RecitalDirective, Runner>();
  const blocks: BlockResult[] = [];
  let ok = true;

  try {
    for (const block of parsed.blocks) {
      const directive = block.directive;
      if (!directive) continue; // not owned by any directive: recital ignores it

      let runner: Runner;
      if (directive.isolate) {
        runner = new Runner({ ...options, shell: directive.cmd });
      } else {
        runner = sessions.get(directive) ?? new Runner({ ...options, shell: directive.cmd });
        sessions.set(directive, runner);
      }

      const result = await runner.runBlock(block);
      if (directive.isolate) await runner.close();

      blocks.push(result);
      if (!result.ok) ok = false;
    }
  } finally {
    for (const runner of sessions.values()) await runner.close();
  }

  return { path: parsed.path, ok, blocks };
}
