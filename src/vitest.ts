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
import { DirectiveSession, type RunnerOptions } from "./runner.js";
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
      const sessions = new Map<RecitalDirective, DirectiveSession>();
      // Shared sessions close here whether tests passed or failed. Isolate
      // sessions close in each test's `finally`. Process kill / hard abort can
      // still skip hooks — same caveat as any vitest afterAll.
      afterAll(async () => {
        for (const session of sessions.values()) await session.close();
      });

      for (const block of runnable) {
        const directive = block.directive!;
        test(blockName(block.heading, block.line), async () => {
          let session: DirectiveSession | undefined;
          try {
            if (directive.isolate) {
              session = await DirectiveSession.open(directive, options);
            } else {
              session =
                sessions.get(directive) ?? (await DirectiveSession.open(directive, options));
              sessions.set(directive, session);
            }

            const result = await session.runBlock(block);
            if (!result.ok) {
              const failed = result.interactions.find((i) => !i.ok);
              throw new Error(failed?.error ?? "Block failed.");
            }
          } finally {
            if (directive.isolate && session) await session.close();
          }
        });
      }
    });
  }
}
