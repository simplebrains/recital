/**
 * Resolve file patterns into a concrete, sorted list of Markdown files.
 *
 * Kept dependency-free: plain paths and directories are handled directly;
 * glob patterns use Node's built-in `fs.globSync` (Node >= 22) when present.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const GLOB_MAGIC = /[*?[\]{}]/;

function walkMarkdown(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdown(full, out);
    } else if (entry.isFile() && /\.mdx?$/.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Resolve one or more path/glob/directory patterns into Markdown file paths. */
export function resolveMarkdownFiles(patterns: string | string[]): string[] {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  const results = new Set<string>();

  for (const pattern of list) {
    if (GLOB_MAGIC.test(pattern)) {
      const globSync = (fs as unknown as { globSync?: (p: string) => string[] }).globSync;
      if (typeof globSync !== "function") {
        throw new Error(
          `Glob patterns require Node >= 22 (fs.globSync). Pattern: ${pattern}. ` +
            `Pass explicit file paths or a directory instead.`,
        );
      }
      for (const match of globSync(pattern)) results.add(path.resolve(match));
      continue;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(pattern);
    } catch {
      throw new Error(`No such file or directory: ${pattern}`);
    }
    if (stat.isDirectory()) {
      const found: string[] = [];
      walkMarkdown(pattern, found);
      for (const f of found) results.add(path.resolve(f));
    } else {
      results.add(path.resolve(pattern));
    }
  }

  return [...results].sort();
}
