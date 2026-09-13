/**
 * Vitest integration.
 *
 * Register a Markdown document (or a set of them) as a vitest suite: one
 * `describe` per file, one `test` per runnable block (a block owned by a
 * recital directive). Blocks that share a non-`isolate` directive share one
 * shell session, so working directory, environment, and captured bindings
 * persist across them; `isolate` blocks each get a fresh session. Tests are
 * registered in document order, so interleaved sessions run in that order.
 *
 * Usage, inside any `*.test.ts`:
 *
 *   import { describeMarkdown } from "recital/vitest";
 *   describeMarkdown("docs/*.md");
 */

import { readFileSync } from "node:fs";
import { afterAll, describe, test } from "vitest";

import { resolveMarkdownFiles } from "./files.js";
import { parseMarkdown } from "./parser.js";
import { Runner, type RunnerOptions } from "./runner.js";
import type { ParsedDocument, RecitalDirective } from "./types.js";

export type DescribeMarkdownOptions = RunnerOptions;

function blockName(heading: string | undefined, line: number): string {
  return heading ? `${heading} (block @ line ${line})` : `block @ line ${line}`;
}

/**
 * Register the given Markdown files/globs/directories as vitest suites.
 */
export function describeMarkdown(
  patterns: string | string[],
  options: DescribeMarkdownOptions = {},
): void {
  const files = resolveMarkdownFiles(patterns);

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    let parsed: ParsedDocument;
    try {
      parsed = parseMarkdown(source, { path: file });
    } catch (err) {
      // A malformed document (e.g. an ambiguous block or a directive missing
      // cmd=) surfaces as a single failing test for the file.
      describe(file, () => {
        test("parse", () => {
          throw err;
        });
      });
      continue;
    }

    const runnable = parsed.blocks.filter((b) => b.directive);
    if (runnable.length === 0) continue;

    describe(file, () => {
      const sessions = new Map<RecitalDirective, Runner>();
      afterAll(async () => {
        for (const runner of sessions.values()) await runner.close();
      });

      for (const block of runnable) {
        const directive = block.directive!;
        test(blockName(block.heading, block.line), async () => {
          let runner: Runner;
          if (directive.isolate) {
            runner = new Runner({ ...options, shell: directive.cmd });
          } else {
            runner =
              sessions.get(directive) ?? new Runner({ ...options, shell: directive.cmd });
            sessions.set(directive, runner);
          }

          try {
            const result = await runner.runBlock(block);
            if (!result.ok) {
              const failed = result.interactions.find((i) => !i.ok);
              throw new Error(failed?.error ?? "Block failed.");
            }
          } finally {
            if (directive.isolate) await runner.close();
          }
        });
      }
    });
  }
}
