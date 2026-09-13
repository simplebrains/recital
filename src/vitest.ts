/**
 * Vitest integration.
 *
 * Register a Markdown document (or a set of them) as a vitest suite: one
 * `describe` per file, one `test` per runnable block, with a shared shell
 * session so working directory, environment, and captured bindings persist
 * across the blocks of a file exactly as they would in a real session.
 *
 * Usage, inside any `*.test.ts`:
 *
 *   import { describeMarkdown } from "recital/vitest";
 *   describeMarkdown("docs/*.md");
 */

import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, test } from "vitest";

import { resolveMarkdownFiles } from "./files.js";
import { parseMarkdown } from "./parser.js";
import { Runner } from "./runner.js";
import type { RunnerOptions } from "./runner.js";

export interface DescribeMarkdownOptions extends RunnerOptions {
  /** Languages treated as runnable CLI sessions. */
  languages?: string[];
}

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
    const parsed = parseMarkdown(source, { path: file, languages: options.languages });
    if (parsed.blocks.length === 0) continue;

    describe(file, () => {
      let runner: Runner;
      beforeAll(() => {
        runner = new Runner(options);
      });
      afterAll(async () => {
        await runner?.close();
      });

      for (const block of parsed.blocks) {
        const name = blockName(block.heading, block.line);
        const register = "skip" in block.options ? test.skip : test;
        register(name, async () => {
          const result = await runner.runBlock(block);
          if (!result.ok) {
            const failed = result.interactions.find((i) => !i.ok);
            throw new Error(failed?.error ?? "Block failed.");
          }
        });
      }
    });
  }
}
