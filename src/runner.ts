/**
 * The runner drives persistent shell sessions through a parsed document's
 * blocks, matches output against expectations, and threads captured bindings
 * forward within each session.
 *
 * A document may declare several sessions (one per non-`isolate` directive);
 * blocks are dispatched to the session of the directive that owns them, but are
 * always executed in document order, even when sessions are interleaved.
 *
 * Session lifecycle (`cwd: temp`, `env`, `setup`, `teardown`) is owned by
 * {@link DirectiveSession}.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  matchBlock,
  normalizeOutput,
  substituteBindings,
  type Bindings,
  type NormalizeOptions,
  type TypeRegistry,
} from "./matcher.js";
import { parseMarkdown, type ParseOptions } from "./parser.js";
import { PromptSession, ShellSession, type Session, type ShellOptions } from "./shell.js";
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
  /**
   * When set, drive the session as an interactive REPL synced on this prompt
   * (or any of these prompts — see {@link PromptSession}) instead of a
   * bash-sentinel shell.
   */
  prompt?: string | readonly string[];
  /** Bash snippet run before the REPL starts (prompt mode only). */
  setup?: string;
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
  readonly session: Session;
  bindings: Bindings = {};
  private readonly options: RunnerOptions;

  constructor(options: RunnerOptions = {}) {
    this.options = options;
    this.session =
      options.prompt !== undefined
        ? new PromptSession({
            shell: options.shell,
            cwd: options.cwd,
            env: options.env,
            prompt: options.prompt,
            setup: options.setup,
          })
        : new ShellSession(options);
  }

  /** Run one interaction against the current session and bindings. */
  async runInteraction(
    interaction: Interaction,
    types: TypeRegistry = {},
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

    let output: string;
    let exitCode: number;
    try {
      ({ output, exitCode } = await this.session.run(executed));
    } catch (err) {
      // Shell death / I/O errors become a failed interaction so callers can
      // still run teardown in a `finally` rather than aborting uncleanly.
      return {
        interaction,
        executed,
        ok: false,
        exitCode: -1,
        output: "",
        error: (err as Error).message,
      };
    }

    const actual = normalizeOutput(output, this.options.normalize);

    // recital asserts output, not exit status; the exit code is informational.
    const match = matchBlock(interaction.expected, actual, this.bindings, types);
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
      const result = await this.runInteraction(interaction, block.types);
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

/** Upper bound for a teardown shell snippet before we abandon it and kill the shell. */
const TEARDOWN_TIMEOUT_MS = 10_000;

/**
 * A shell session bound to one recital directive, including lifecycle hooks
 * (`setup` / `teardown`) and optional host-managed temp `cwd`.
 *
 * {@link DirectiveSession.close} always attempts teardown (then kills the shell
 * and removes a temp cwd), whether the session's blocks passed or failed.
 * Teardown is best-effort: a hung/dead shell will not block process cleanup
 * forever (see TEARDOWN_TIMEOUT_MS).
 */
export class DirectiveSession {
  readonly runner: Runner;
  private readonly tempDir: string | null;
  private readonly teardown: string | undefined;
  private closed = false;

  private constructor(runner: Runner, tempDir: string | null, teardown: string | undefined) {
    this.runner = runner;
    this.tempDir = tempDir;
    this.teardown = teardown;
  }

  /** Open a session for `directive`, applying cwd/env/setup. */
  static async open(
    directive: RecitalDirective,
    options: RunnerOptions = {},
  ): Promise<DirectiveSession> {
    let tempDir: string | null = null;
    let cwd = options.cwd;
    if (directive.cwd === "temp") {
      tempDir = await mkdtemp(join(tmpdir(), "recital-"));
      cwd = tempDir;
    } else if (directive.cwd !== undefined) {
      cwd = directive.cwd;
    }

    const env = { ...options.env, ...directive.env };
    // Prompt mode drives a REPL, not a bash shell: `setup` can't be run as a
    // post-start command (the REPL wouldn't understand it), so it is handed to
    // the PromptSession, which runs it in the launching bash before exec'ing the
    // REPL. `teardown` is likewise not a REPL command, so it is not run.
    const promptMode = directive.prompt !== undefined;
    const runner = new Runner({
      ...options,
      shell: directive.cmd,
      cwd,
      env,
      prompt: directive.prompt,
      setup: promptMode ? directive.setup : undefined,
    });

    const teardown = promptMode ? undefined : directive.teardown;
    const session = new DirectiveSession(runner, tempDir, teardown);
    if (directive.setup && !promptMode) {
      try {
        const result = await runner.session.run(directive.setup);
        if (result.exitCode !== 0) {
          await session.close();
          throw new Error(
            `recital setup on line ${directive.line} exited ${result.exitCode}:\n${result.output}`,
          );
        }
      } catch (err) {
        await session.close();
        throw err;
      }
    }
    return session;
  }

  async runBlock(block: Block): Promise<BlockResult> {
    return this.runner.runBlock(block);
  }

  /**
   * Run teardown (if any), close the shell, and remove a temp cwd.
   * Safe to call more than once. Always proceeds to shell/temp cleanup even if
   * the teardown snippet fails, times out, or the shell is already dead.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.teardown) {
        try {
          await Promise.race([
            this.runner.session.run(this.teardown),
            new Promise<never>((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error("recital teardown timed out")),
                TEARDOWN_TIMEOUT_MS,
              );
              timer.unref?.();
            }),
          ]);
        } catch {
          // Still tear down the shell / temp dir even if teardown fails.
        }
      }
    } finally {
      try {
        await this.runner.close();
      } finally {
        if (this.tempDir) {
          await rm(this.tempDir, { recursive: true, force: true });
        }
      }
    }
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
 *
 * Shared sessions are always closed in a `finally` (pass or fail). Isolated
 * sessions are closed in a per-block `finally`.
 */
export async function runParsedDocument(
  parsed: ParsedDocument,
  options: RunnerOptions = {},
): Promise<DocumentResult> {
  const sessions = new Map<RecitalDirective, DirectiveSession>();
  const blocks: BlockResult[] = [];
  let ok = true;

  try {
    for (const block of parsed.blocks) {
      const directive = block.directive;
      if (!directive) continue;

      if (directive.isolate) {
        const session = await DirectiveSession.open(directive, options);
        try {
          const result = await session.runBlock(block);
          blocks.push(result);
          if (!result.ok) ok = false;
        } finally {
          await session.close();
        }
        continue;
      }

      const session =
        sessions.get(directive) ?? (await DirectiveSession.open(directive, options));
      sessions.set(directive, session);

      const result = await session.runBlock(block);
      blocks.push(result);
      if (!result.ok) ok = false;
    }
  } finally {
    for (const session of sessions.values()) await session.close();
  }

  return { path: parsed.path, ok, blocks };
}
