/**
 * Expand `<!-- recital include: <path> -->` comments by transcluding the
 * referenced Markdown file in place.
 *
 * Includes are intentionally not session settings: they are a source-level
 * rewrite that runs before parsing. Nested includes resolve relative to the
 * file that contains them. Circular includes are rejected.
 */

import { readFileSync } from "node:fs";
import * as path from "node:path";

import { parse as parseYaml } from "yaml";

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
/** Opening of a recital HTML comment: `<!-- recital:` or `<!-- recital key:`. */
const RECITAL_OPEN_RE = /^\s*<!--\s*recital(?:\s+([A-Za-z_][A-Za-z0-9_]*))?:(.*)$/;

export interface ExpandIncludesOptions {
  /**
   * Path of the document being expanded (used for cycle detection and as the
   * default base for relative includes).
   */
  path?: string;
  /** Directory used to resolve relative include paths. */
  baseDir?: string;
  /** Read a file by absolute path. Defaults to `fs.readFileSync`. */
  readFile?: (absolutePath: string) => string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function defaultReadFile(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (err) {
    throw new Error(
      `Cannot read included file ${absolutePath}: ${(err as Error).message}`,
    );
  }
}

/** Split into lines, dropping the empty segment left by a trailing newline. */
function splitLines(source: string): string[] {
  const lines = source.split(/\r\n?|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "" && /\r?\n$/.test(source)) {
    lines.pop();
  }
  return lines;
}

/**
 * Read a recital HTML comment starting at `startIdx`. Returns the desugared
 * YAML mapping plus the index of the line containing `-->`.
 */
function readRecitalComment(
  lines: string[],
  startIdx: number,
): { map: Record<string, unknown>; endIdx: number; line: number } {
  const open = RECITAL_OPEN_RE.exec(lines[startIdx]!);
  if (!open) {
    throw new Error(`internal: expected recital comment on line ${startIdx + 1}`);
  }
  const prefixKey = open[1];
  let buf = open[2] ?? "";
  let i = startIdx;

  while (true) {
    const close = buf.indexOf("-->");
    if (close !== -1) {
      const yamlText = buf.slice(0, close);
      let value: unknown;
      try {
        value = parseYaml(yamlText);
      } catch (err) {
        throw new Error(
          `recital comment on line ${startIdx + 1} has invalid YAML: ${(err as Error).message}`,
        );
      }

      let map: Record<string, unknown>;
      if (prefixKey) {
        map = { [prefixKey]: value };
      } else if (isPlainObject(value)) {
        map = value;
      } else {
        throw new Error(
          `recital comment on line ${startIdx + 1} must be a YAML mapping ` +
            `(or use a key prefix such as "include:" or "cmd:").`,
        );
      }
      return { map, endIdx: i, line: startIdx + 1 };
    }
    i++;
    if (i >= lines.length) {
      throw new Error(`Unclosed recital comment starting on line ${startIdx + 1}.`);
    }
    buf += "\n" + lines[i];
  }
}

function parseIncludePath(map: Record<string, unknown>, line: number): string | undefined {
  if (!("include" in map)) return undefined;

  const keys = Object.keys(map);
  if (keys.length !== 1) {
    throw new Error(
      `recital include on line ${line} must stand alone ` +
        `(do not combine include with other fields: ${keys.filter((k) => k !== "include").join(", ")}).`,
    );
  }

  const value = map.include;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `recital include on line ${line} must be a non-empty path string.`,
    );
  }
  return value.trim();
}

function expandSource(
  source: string,
  baseDir: string,
  stack: Set<string>,
  readFile: (absolutePath: string) => string,
  label: string,
): string {
  const lines = splitLines(source);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i]!;
    const fence = FENCE_RE.exec(raw);

    if (fence) {
      const [, , marker] = fence;
      const closeRe = new RegExp(`^\\s*${marker![0]}{${marker!.length},}\\s*$`);
      out.push(raw);
      i++;
      while (i < lines.length && !closeRe.test(lines[i]!)) {
        out.push(lines[i]!);
        i++;
      }
      if (i < lines.length) {
        out.push(lines[i]!);
        i++;
      }
      continue;
    }

    if (RECITAL_OPEN_RE.test(raw)) {
      const { map, endIdx, line } = readRecitalComment(lines, i);
      const includePath = parseIncludePath(map, line);
      if (includePath === undefined) {
        for (let j = i; j <= endIdx; j++) out.push(lines[j]!);
        i = endIdx + 1;
        continue;
      }

      const resolved = path.resolve(baseDir, includePath);
      if (stack.has(resolved)) {
        const chain = [...stack, resolved].join(" → ");
        throw new Error(
          `Circular recital include on line ${line} of ${label}: ${chain}`,
        );
      }

      let included: string;
      try {
        included = readFile(resolved);
      } catch (err) {
        throw new Error(
          `recital include on line ${line} of ${label}: ${(err as Error).message}`,
        );
      }

      stack.add(resolved);
      try {
        const expanded = expandSource(
          included,
          path.dirname(resolved),
          stack,
          readFile,
          resolved,
        );
        if (expanded.length > 0) {
          out.push(...splitLines(expanded));
        }
      } finally {
        stack.delete(resolved);
      }
      i = endIdx + 1;
      continue;
    }

    out.push(raw);
    i++;
  }

  return out.join("\n");
}

/**
 * Replace include comments with the contents of the referenced files.
 * Non-include recital comments and fenced blocks are left untouched.
 */
export function expandIncludes(
  source: string,
  opts: ExpandIncludesOptions = {},
): string {
  const absPath =
    opts.path && opts.path !== "<inline>" ? path.resolve(opts.path) : undefined;
  const baseDir =
    opts.baseDir ?? (absPath ? path.dirname(absPath) : process.cwd());
  const readFile = opts.readFile ?? defaultReadFile;
  const stack = new Set<string>();
  if (absPath) stack.add(absPath);

  const expanded = expandSource(
    source,
    baseDir,
    stack,
    readFile,
    opts.path ?? "<inline>",
  );
  // Preserve a trailing newline when the input had one (splitLines drops it).
  if (/\r?\n$/.test(source) && expanded.length > 0 && !/\r?\n$/.test(expanded)) {
    return expanded + "\n";
  }
  return expanded;
}
