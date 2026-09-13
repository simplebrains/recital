/**
 * Markdown parsing.
 *
 * We keep dependencies at zero and scan line-by-line for fenced code blocks
 * whose info string names a runnable language (default: `console`). Inside a
 * block, `$ ` introduces a command; `> ` continues the previous command; every
 * other line up to the next command is that command's expected output.
 *
 * A block can also stay fully literal — reading like a real terminal session
 * with no `{{…}}` markup — by declaring a value to be *an identity to itself*
 * in an HTML comment *outside* the fence, which is invisible in rendered
 * Markdown. The signal is just a real-looking value in quotes:
 *
 *   <!-- "/var/folders/.../tmp.abc123" -->
 *
 * That says: wherever the exact string `/var/folders/.../tmp.abc123` appears in
 * the following session, treat every occurrence as the same value — capture it
 * on first sight and require it to recur (and substitute it into commands)
 * everywhere after. The point is identity, so no name is required. An optional
 * name and/or type may still be given:
 *
 *   <!-- workdir "…" -->        name it `workdir`
 *   <!-- workdir:path "…" -->   name it and constrain the capture to `path`
 *   <!-- :path "…" -->          anonymous, but constrain the capture to `path`
 *
 * Each declaration rewrites its matching literal in later blocks into the
 * equivalent `{{name}}` / `{{name:type}}` token, so the rest of the pipeline is
 * unchanged. Anonymous declarations get an internal, never-rendered synthetic
 * name; they only ever exist as identities.
 */

import type { Block, Interaction, ParsedDocument } from "./types.js";

export interface ParseOptions {
  /** Languages treated as runnable CLI sessions. Default: console family. */
  languages?: string[];
  /** Path/label recorded on the parsed document. */
  path?: string;
}

/** A `<!-- [name][:type] "value" -->` identity declaration. */
export interface IdentityDeclaration {
  /** The binding name — synthesized internally for anonymous declarations. */
  name: string;
  type?: string;
  /** The literal placeholder string that stands in for the binding. */
  value: string;
  /** Whether the name was synthesized (the declaration gave no name). */
  anonymous: boolean;
}

const DEFAULT_LANGUAGES = ["console", "shell-session", "shellsession", "session"];
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;
// An identity declaration: an HTML comment whose entire content is an optional
// `name` and/or `:type` prefix followed by a quoted value. The strict shape
// keeps ordinary HTML comments (`<!-- TODO … -->`) from being mistaken for one.
const LITERAL_RE =
  /^\s*<!--\s*(?:([A-Za-z_][A-Za-z0-9_]*)?(?::([A-Za-z]+))?[ \t]+)?(?:"([^"]*)"|'([^']*)')\s*-->\s*$/;

/**
 * Rewrite declared literal placeholders in a piece of text into the equivalent
 * `{{name}}` / `{{name:type}}` token. Longer placeholders are applied first so
 * a placeholder that contains another is not partially replaced.
 */
function applyLiterals(text: string, declarations: IdentityDeclaration[]): string {
  let out = text;
  const ordered = [...declarations].sort((a, b) => b.value.length - a.value.length);
  for (const decl of ordered) {
    if (!decl.value) continue;
    const token = decl.type ? `{{${decl.name}:${decl.type}}}` : `{{${decl.name}}}`;
    out = out.split(decl.value).join(token);
  }
  return out;
}

/** Parse a fence info string into a language and key/value options. */
function parseInfoString(info: string): { lang: string; options: Record<string, string> } {
  const options: Record<string, string> = {};
  const tokens = tokenizeInfo(info.trim());
  const lang = (tokens.shift() ?? "").toLowerCase();
  for (const tok of tokens) {
    const eq = tok.indexOf("=");
    if (eq === -1) {
      options[tok] = "true";
    } else {
      const key = tok.slice(0, eq);
      let value = tok.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      options[key] = value;
    }
  }
  return { lang, options };
}

/** Split an info string on whitespace while respecting quotes. */
function tokenizeInfo(info: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of info) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (/\s/.test(ch)) {
      if (current) tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/** Parse the body lines of a runnable block into ordered interactions. */
function parseInteractions(lines: { text: string; line: number }[]): Interaction[] {
  const interactions: Interaction[] = [];
  let current: Interaction | null = null;

  for (const { text, line } of lines) {
    const promptMatch = /^\$\s?(.*)$/.exec(text);
    const contMatch = /^>\s?(.*)$/.exec(text);

    if (promptMatch) {
      if (current) interactions.push(current);
      current = { command: promptMatch[1]!, expected: [], line };
    } else if (contMatch && current && current.expected.length === 0) {
      // Secondary-prompt continuation of the command (before any output).
      current.command += "\n" + contMatch[1]!;
    } else if (current) {
      current.expected.push(text);
    }
    // Lines before the first prompt are ignored.
  }
  if (current) interactions.push(current);
  return interactions;
}

/** Parse a Markdown document into runnable blocks. */
export function parseMarkdown(source: string, opts: ParseOptions = {}): ParsedDocument {
  const languages = new Set((opts.languages ?? DEFAULT_LANGUAGES).map((l) => l.toLowerCase()));
  const lines = source.split(/\r\n?|\n/);
  const blocks: Block[] = [];

  let lastHeading: string | undefined;
  const declarations: IdentityDeclaration[] = [];
  let anonCount = 0;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i]!;
    const fence = FENCE_RE.exec(raw);

    if (!fence) {
      const literal = LITERAL_RE.exec(raw);
      if (literal) {
        const name = literal[1];
        const value = literal[3] ?? literal[4] ?? "";
        declarations.push({
          name: name ?? `__recital_anon_${anonCount++}`,
          type: literal[2],
          value,
          anonymous: name === undefined,
        });
        i++;
        continue;
      }
      const heading = HEADING_RE.exec(raw);
      if (heading) lastHeading = heading[1];
      i++;
      continue;
    }

    const [, indent, marker, info] = fence;
    const { lang, options } = parseInfoString(info!);
    const openLine = i + 1; // 1-based
    const closeRe = new RegExp(`^\\s*${marker![0]}{${marker!.length},}\\s*$`);

    // Collect the block body until the matching closing fence.
    const body: { text: string; line: number }[] = [];
    i++;
    while (i < lines.length && !closeRe.test(lines[i]!)) {
      // Strip the opening fence's indentation, if present.
      let text = lines[i]!;
      if (indent && text.startsWith(indent)) text = text.slice(indent.length);
      body.push({ text, line: i + 1 });
      i++;
    }
    i++; // consume closing fence

    if (languages.has(lang)) {
      // Rewrite any declared literals into the equivalent binding tokens so the
      // rest of the pipeline is unchanged. Declarations seen before this block
      // apply; the placeholder captures on first sight and back-references after.
      const interactions = parseInteractions(body).map((it) => ({
        ...it,
        command: applyLiterals(it.command, declarations),
        expected: it.expected.map((l) => applyLiterals(l, declarations)),
      }));
      blocks.push({ lang, options, interactions, line: openLine, heading: lastHeading });
    }
  }

  return { path: opts.path ?? "<inline>", blocks };
}
