/**
 * Markdown parsing.
 *
 * We keep dependencies at zero and scan line-by-line for fenced code blocks.
 * By default recital interprets *nothing* — a document opts in with one or more
 * directive comments:
 *
 *   <!-- recital cmd=bash -->                    interpret every code block
 *   <!-- recital syntax=shell cmd=bash -->       ...only blocks fenced ```shell
 *   <!-- recital pragma="Bob logs in" cmd=bash -->  ...only blocks whose fence
 *                                                    pragma contains that text
 *   <!-- recital cmd=bash isolate -->            each matching block gets its
 *                                                own fresh session
 *
 * Directives are file-global: every code block is matched against all of the
 * directives in the document. All blocks matching a (non-`isolate`) directive
 * share one persistent session; blocks are always executed in document order,
 * even when several sessions are interleaved. `cmd=` is required. A block that
 * matches more than one directive is ambiguous and is a parse error.
 *
 * Inside a block, `$ ` introduces a command; `> ` continues the previous
 * command; every other line up to the next command is that command's expected
 * output.
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
 * name; they only ever exist as identities. Unlike directives, identity
 * declarations are positional: they apply only to blocks that follow them.
 */

import type { Block, Interaction, ParsedDocument, RecitalDirective } from "./types.js";

export interface ParseOptions {
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

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;
// A `<!-- recital … -->` directive comment. The attribute text is captured.
const DIRECTIVE_RE = /^\s*<!--\s*recital\b(.*?)\s*-->\s*$/;
// An identity declaration: an HTML comment whose entire content is an optional
// `name` and/or `:type` prefix followed by a quoted value. The strict shape
// keeps ordinary HTML comments (`<!-- TODO … -->`) from being mistaken for one.
const IDENTITY_RE =
  /^\s*<!--\s*(?:([A-Za-z_][A-Za-z0-9_]*)?(?::([A-Za-z]+))?[ \t]+)?(?:"([^"]*)"|'([^']*)')\s*-->\s*$/;

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Split a string on whitespace while respecting quotes. */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of text) {
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

/** Parse the attribute text of a `<!-- recital … -->` directive. */
function parseDirective(attrs: string, line: number): RecitalDirective {
  let cmd: string | undefined;
  let syntax: string | undefined;
  let pragma: string | undefined;
  let isolate = false;

  for (const tok of tokenize(attrs.trim())) {
    const eq = tok.indexOf("=");
    if (eq === -1) {
      if (tok === "isolate") {
        isolate = true;
      } else {
        throw new Error(
          `recital directive on line ${line} has unknown flag "${tok}". ` +
            `Expected key=value attributes (cmd, syntax, pragma) or the "isolate" flag.`,
        );
      }
      continue;
    }
    const key = tok.slice(0, eq);
    const value = stripQuotes(tok.slice(eq + 1));
    switch (key) {
      case "cmd":
        cmd = value;
        break;
      case "syntax":
        syntax = value.toLowerCase();
        break;
      case "pragma":
        pragma = value;
        break;
      default:
        throw new Error(
          `recital directive on line ${line} has unknown attribute "${key}". ` +
            `Known attributes: cmd, syntax, pragma; flag: isolate.`,
        );
    }
  }

  if (!cmd) {
    throw new Error(`recital directive on line ${line} is missing required cmd= attribute.`);
  }
  return { cmd, syntax, pragma, isolate, line };
}

/** Split a fence info string into its language token and trailing pragma. */
function parseFenceInfo(info: string): { lang: string; pragma: string } {
  const trimmed = info.trim();
  if (!trimmed) return { lang: "", pragma: "" };
  const m = /^(\S+)\s*([\s\S]*)$/.exec(trimmed);
  return { lang: m![1]!.toLowerCase(), pragma: m![2]!.trim() };
}

/** Find the single directive that owns a block, erroring if more than one does. */
function matchDirective(
  lang: string,
  pragma: string,
  directives: RecitalDirective[],
  blockLine: number,
): RecitalDirective | undefined {
  const matches = directives.filter((d) => {
    if (d.syntax !== undefined && d.syntax !== lang) return false;
    if (d.pragma !== undefined && !pragma.includes(d.pragma)) return false;
    return true;
  });
  if (matches.length > 1) {
    const lines = matches.map((d) => d.line).join(", ");
    throw new Error(
      `Code block on line ${blockLine} matches multiple recital directives ` +
        `(lines ${lines}). Make the directives' syntax/pragma selectors disjoint.`,
    );
  }
  return matches[0];
}

/**
 * Rewrite declared identity placeholders in a piece of text into the equivalent
 * `{{name}}` / `{{name:type}}` token. Longer placeholders are applied first so
 * a placeholder that contains another is not partially replaced.
 */
function applyIdentities(text: string, declarations: IdentityDeclaration[]): string {
  let out = text;
  const ordered = [...declarations].sort((a, b) => b.value.length - a.value.length);
  for (const decl of ordered) {
    if (!decl.value) continue;
    const token = decl.type ? `{{${decl.name}:${decl.type}}}` : `{{${decl.name}}}`;
    out = out.split(decl.value).join(token);
  }
  return out;
}

/** Parse the body lines of a runnable block into ordered interactions. */
function parseInteractions(
  lines: { text: string; line: number }[],
  declarations: IdentityDeclaration[],
): Interaction[] {
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

  // Rewrite declared identities into the equivalent binding tokens so the rest
  // of the pipeline is unchanged.
  return interactions.map((it) => ({
    ...it,
    command: applyIdentities(it.command, declarations),
    expected: it.expected.map((l) => applyIdentities(l, declarations)),
  }));
}

interface RawBlock {
  lang: string;
  pragma: string;
  body: { text: string; line: number }[];
  line: number;
  heading?: string;
  /** Identity declarations in effect where this block appeared. */
  declarations: IdentityDeclaration[];
}

/** Parse a Markdown document into directives and code blocks. */
export function parseMarkdown(source: string, opts: ParseOptions = {}): ParsedDocument {
  const lines = source.split(/\r\n?|\n/);
  const directives: RecitalDirective[] = [];
  const rawBlocks: RawBlock[] = [];

  let lastHeading: string | undefined;
  const declarations: IdentityDeclaration[] = [];
  let anonCount = 0;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i]!;
    const fence = FENCE_RE.exec(raw);

    if (!fence) {
      const directive = DIRECTIVE_RE.exec(raw);
      if (directive) {
        directives.push(parseDirective(directive[1] ?? "", i + 1));
        i++;
        continue;
      }
      const identity = IDENTITY_RE.exec(raw);
      if (identity) {
        const name = identity[1];
        declarations.push({
          name: name ?? `__recital_anon_${anonCount++}`,
          type: identity[2],
          value: identity[3] ?? identity[4] ?? "",
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
    const { lang, pragma } = parseFenceInfo(info!);
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

    rawBlocks.push({
      lang,
      pragma,
      body,
      line: openLine,
      heading: lastHeading,
      declarations: [...declarations],
    });
  }

  // Directives are file-global, so resolve each block against all of them now
  // that the whole document has been scanned.
  const blocks: Block[] = rawBlocks.map((rb) => ({
    lang: rb.lang,
    pragma: rb.pragma,
    interactions: parseInteractions(rb.body, rb.declarations),
    line: rb.line,
    heading: rb.heading,
    directive: matchDirective(rb.lang, rb.pragma, directives, rb.line),
  }));

  return { path: opts.path ?? "<inline>", directives, blocks };
}
