/**
 * Expectation matching.
 *
 * Expected-output templates are ordinary text by default. A small set of
 * opt-in tokens covers nondeterminism:
 *
 *   {{name:type}}   typed named capture — binds `name` to the observed value
 *   {{name}}        named capture (type `any`); if `name` is already bound it
 *                   is a back-reference requiring the same value to recur
 *   {{:type}}       anonymous typed wildcard — matches, binds nothing
 *   {{*}}           anonymous wildcard — matches any non-empty run, binds nothing
 *
 * A line consisting solely of `...` (or `{{...}}`) is a line-level ellipsis: it
 * matches zero or more arbitrary output lines.
 *
 * Aside from the reserved built-in `any`, token types are user-defined regex
 * fragments declared with `<!-- recital type: … -->`.
 */

import type { LineMatch } from "./types.js";

/** User-defined matcher type name → regex fragment. */
export type TypeRegistry = Record<string, string>;

/** Regex fragment for the reserved built-in type `any`. */
export const ANY_PATTERN = ".+?";

/**
 * Strip a single leading `^` and trailing `$` so full-string-looking patterns
 * still work as capture fragments inside a larger line regex.
 */
export function normalizeTypePattern(pattern: string): string {
  let p = pattern;
  if (p.startsWith("^")) p = p.slice(1);
  if (p.endsWith("$")) p = p.slice(0, -1);
  return p;
}

/** Resolve a type name to a regex fragment. */
export function resolveTypePattern(type: string, types: TypeRegistry): string {
  if (type === "any") return ANY_PATTERN;
  const pattern = types[type];
  if (pattern === undefined) {
    const known = ["any", ...Object.keys(types)].join(", ");
    throw new Error(
      `Unknown matcher type "${type}". Declare it with \`recital type:\`. Known types: ${known}`,
    );
  }
  return pattern;
}

export type Bindings = Record<string, string>;

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

interface ParsedToken {
  kind: "anon" | "named";
  name?: string;
  type: string;
}

function parseTokenBody(body: string): ParsedToken {
  if (body === "*" || body === "...") {
    return { kind: "anon", type: "any" };
  }
  if (body.startsWith(":")) {
    return { kind: "anon", type: body.slice(1) };
  }
  const colon = body.indexOf(":");
  const name = colon === -1 ? body : body.slice(0, colon);
  const type = colon === -1 ? "any" : body.slice(colon + 1);
  if (!IDENT_RE.test(name)) {
    throw new Error(
      `Invalid capture name "${name}" in token "{{${body}}}". Names must match ${IDENT_RE}.`,
    );
  }
  if (type !== "any" && !IDENT_RE.test(type)) {
    throw new Error(
      `Invalid type name "${type}" in token "{{${body}}}". Types must match ${IDENT_RE}.`,
    );
  }
  return { kind: "named", name, type };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface CompiledLine {
  regex: RegExp;
  /** Names that produced a fresh capture group in this line. */
  newNames: string[];
}

/**
 * Compile one expected-output line into an anchored RegExp, given the bindings
 * already in scope. Already-bound names are inlined as literals (enforcing
 * consistency); repeated names within the line become back-references.
 */
export function compileLine(
  template: string,
  bindings: Bindings,
  types: TypeRegistry = {},
): CompiledLine {
  let out = "^";
  let lastEnd = 0;
  const usedNames = new Set<string>();
  const newNames: string[] = [];

  TOKEN_RE.lastIndex = 0;
  for (const m of template.matchAll(TOKEN_RE)) {
    out += escapeRegex(template.slice(lastEnd, m.index));
    const token = parseTokenBody(m[1]!.trim());
    const pattern = resolveTypePattern(token.type, types);

    if (token.kind === "anon") {
      out += `(?:${pattern})`;
    } else {
      const name = token.name!;
      if (name in bindings) {
        // Reference to a value bound on an earlier line: match it literally.
        out += escapeRegex(bindings[name]!);
      } else if (usedNames.has(name)) {
        // Second occurrence within this same line: back-reference.
        out += `\\k<${name}>`;
      } else {
        usedNames.add(name);
        newNames.push(name);
        out += `(?<${name}>${pattern})`;
      }
    }
    lastEnd = m.index! + m[0].length;
  }
  out += escapeRegex(template.slice(lastEnd));
  out += "$";

  return { regex: new RegExp(out), newNames };
}

/** Match a single expected line against a single actual line. */
export function matchLine(
  template: string,
  actual: string,
  bindings: Bindings,
  types: TypeRegistry = {},
): LineMatch {
  const { regex, newNames } = compileLine(template, bindings, types);
  const m = regex.exec(actual);
  if (!m) return { ok: false, captures: {} };
  const captures: Record<string, string> = {};
  for (const name of newNames) {
    captures[name] = m.groups?.[name] ?? "";
  }
  return { ok: true, captures };
}

function isEllipsis(line: string): boolean {
  const t = line.trim();
  return t === "..." || t === "{{...}}" || t === "{{*}}...";
}

export interface BlockMatchResult {
  ok: boolean;
  bindings: Bindings;
  /** Index of the expected line that failed, when `ok` is false. */
  failedAt?: number;
}

/**
 * Match a block of expected lines against actual output lines, threading
 * bindings. Supports line-level `...` ellipsis (zero or more arbitrary lines).
 */
export function matchBlock(
  expected: string[],
  actual: string[],
  bindings: Bindings,
  types: TypeRegistry = {},
): BlockMatchResult {
  // Empty expectation: caller doesn't care about output.
  if (expected.length === 0) return { ok: true, bindings };

  let deepestExpected = 0;

  function go(ei: number, ai: number, binds: Bindings): Bindings | null {
    deepestExpected = Math.max(deepestExpected, ei);
    if (ei === expected.length) {
      return ai === actual.length ? binds : null;
    }
    const line = expected[ei]!;
    if (isEllipsis(line)) {
      // Try consuming k actual lines (greedy from most so `...` at end works,
      // but we search from fewest to keep captures maximally constrained).
      for (let k = ai; k <= actual.length; k++) {
        const res = go(ei + 1, k, binds);
        if (res) return res;
      }
      return null;
    }
    if (ai >= actual.length) return null;
    const lm = matchLine(line, actual[ai]!, binds, types);
    if (!lm.ok) return null;
    return go(ei + 1, ai + 1, { ...binds, ...lm.captures });
  }

  const result = go(0, 0, bindings);
  if (result) return { ok: true, bindings: result };
  return { ok: false, bindings, failedAt: deepestExpected };
}

/** Strip ANSI escape sequences from text. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export interface NormalizeOptions {
  stripAnsi?: boolean;
  /** Trim trailing whitespace from each line. Default true. */
  trimTrailingWhitespace?: boolean;
}

/**
 * Normalize raw output into an array of lines: normalize newlines, optionally
 * strip ANSI, trim trailing whitespace per line, and drop leading/trailing
 * blank lines (which shell prompts and formatting tend to introduce).
 */
export function normalizeOutput(
  raw: string,
  opts: NormalizeOptions = {},
): string[] {
  const stripAnsiCodes = opts.stripAnsi ?? true;
  const trimTrailing = opts.trimTrailingWhitespace ?? true;

  let text = raw.replace(/\r\n?/g, "\n");
  if (stripAnsiCodes) text = stripAnsi(text);

  let lines = text.split("\n");
  if (trimTrailing) lines = lines.map((l) => l.replace(/\s+$/, ""));

  // Drop leading and trailing blank lines.
  while (lines.length > 0 && lines[0] === "") lines.shift();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return lines;
}

/** Substitute bound `{{name}}` / `{{name:type}}` references into a command. */
export function substituteBindings(command: string, bindings: Bindings): string {
  TOKEN_RE.lastIndex = 0;
  return command.replace(TOKEN_RE, (whole, body: string) => {
    const trimmed = body.trim();
    // Named tokens (`{{name}}` or `{{name:type}}`) reference a binding; the type
    // is irrelevant when substituting a known value into a command. Anonymous
    // tokens (`{{*}}`, `{{:type}}`) never name a binding, so leave them alone.
    const colon = trimmed.indexOf(":");
    const name = colon === -1 ? trimmed : trimmed.slice(0, colon);
    if (!IDENT_RE.test(name)) return whole;
    if (name in bindings) return bindings[name]!;
    // An untyped `{{name}}` in a command is always a reference, so an unbound
    // one is an error. A typed `{{name:type}}` is a capture form that only
    // captures in output; left literal here it can't be captured from a command.
    if (colon === -1) {
      throw new Error(
        `Command references unbound value {{${trimmed}}}. Capture it in an earlier expectation first.`,
      );
    }
    return whole;
  });
}
