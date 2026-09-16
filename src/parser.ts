/**
 * Markdown parsing.
 *
 * By default recital interprets *nothing*. A document opts in with one or more
 * `<!-- recital … -->` comments whose body is YAML:
 *
 *   <!-- recital cmd: bash -->
 *   <!-- recital: { cmd: bash, syntax: console } -->
 *   <!-- recital type: { hex: "[0-9a-f]+" } -->
 *   <!-- recital bind: "/tmp/x" -->
 *   <!-- recital include: ./setup.md -->
 *
 * Prefix sugar `<!-- recital <key>: <yaml> -->` desugars to `{ <key>: <yaml> }`.
 * A mapping with `cmd` is a file-global session directive; `type` declares named
 * regex fragments; `bind` is a positional literal-identity declaration.
 * `include` is expanded before parsing (see {@link expandIncludes}).
 *
 * Inside a block, `$ ` introduces a command; `> ` continues the previous
 * command; every other line up to the next command is that command's expected
 * output.
 */

import { parse as parseYaml } from "yaml";

import {
  expandIncludes,
  type ExpandIncludesOptions,
} from "./include.js";
import {
  normalizeTypePattern,
  type TypeRegistry,
} from "./matcher.js";
import type { Block, Interaction, ParsedDocument, RecitalDirective } from "./types.js";

export interface ParseOptions extends ExpandIncludesOptions {
  /** Path/label recorded on the parsed document. */
  path?: string;
}

/** A `bind` identity declaration. */
export interface IdentityDeclaration {
  /** The binding name — synthesized internally for anonymous declarations. */
  name: string;
  type?: string;
  /**
   * The literal placeholder string that stands in for the binding. Absent for
   * type-only binds, which are expanded per block by scanning for type matches.
   */
  text?: string;
  /** Whether the name was synthesized (the declaration gave no name). */
  anonymous: boolean;
}

const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const HEADING_RE = /^#{1,6}\s+(.*?)\s*#*\s*$/;
/** Opening of a recital HTML comment: `<!-- recital:` or `<!-- recital key:`. */
const RECITAL_OPEN_RE = /^\s*<!--\s*recital(?:\s+([A-Za-z_][A-Za-z0-9_]*))?:(.*)$/;
const TYPE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const COMMENT_KEYS = new Set([
  "cmd",
  "prompt",
  "syntax",
  "pragma",
  "isolate",
  "cwd",
  "env",
  "setup",
  "teardown",
  "bind",
  "type",
]);

const SESSION_ONLY_KEYS = new Set([
  "cmd",
  "prompt",
  "syntax",
  "pragma",
  "isolate",
  "cwd",
  "env",
  "setup",
  "teardown",
]);

/** Rewrite declared identity placeholders into `{{name}}` / `{{name:type}}`. */
function applyIdentities(text: string, declarations: IdentityDeclaration[]): string {
  let out = text;
  const ordered = [...declarations]
    .filter((d) => d.text)
    .sort((a, b) => b.text!.length - a.text!.length);
  for (const decl of ordered) {
    const token = decl.type ? `{{${decl.name}:${decl.type}}}` : `{{${decl.name}}}`;
    out = out.split(decl.text!).join(token);
  }
  return out;
}

/**
 * Expand type-only bind directives into concrete anonymous identities by
 * scanning the block body for matches of each type's pattern.
 */
function expandTypeOnlyBinds(
  scanTexts: string[],
  declarations: IdentityDeclaration[],
  types: TypeRegistry,
  nextAnon: () => string,
  blockLine: number,
): IdentityDeclaration[] {
  const concrete = declarations.filter((d) => d.text !== undefined);
  const typeOnly = declarations.filter((d) => d.text === undefined);
  if (typeOnly.length === 0) return concrete;

  const claimed = new Set(concrete.map((d) => d.text!));
  const expanded = [...concrete];

  for (const decl of typeOnly) {
    const typeName = decl.type;
    if (!typeName) {
      throw new Error(
        `recital bind for block on line ${blockLine} has a type-only entry without a type.`,
      );
    }
    if (typeName === "any") {
      throw new Error(
        `recital bind for block on line ${blockLine} cannot use type-only bind with reserved type "any".`,
      );
    }
    const pattern = types[typeName];
    if (pattern === undefined) {
      const known = ["any", ...Object.keys(types)].join(", ");
      throw new Error(
        `recital bind for block on line ${blockLine} references unknown type "${typeName}". ` +
          `Declare it with \`recital type:\`. Known types: ${known}`,
      );
    }

    let re: RegExp;
    try {
      re = new RegExp(pattern, "g");
    } catch (err) {
      throw new Error(
        `recital type "${typeName}" has invalid regex for block on line ${blockLine}: ${(err as Error).message}`,
      );
    }

    const found = new Set<string>();
    for (const text of scanTexts) {
      re.lastIndex = 0;
      for (const m of text.matchAll(re)) {
        const match = m[0];
        if (match && !claimed.has(match)) found.add(match);
      }
    }
    for (const text of found) {
      claimed.add(text);
      expanded.push({
        name: nextAnon(),
        type: typeName,
        text,
        anonymous: true,
      });
    }
  }

  return expanded;
}

/** Collect command/expected text from a block body for type-only scanning. */
function collectScanTexts(lines: { text: string; line: number }[]): string[] {
  const texts: string[] = [];
  let currentCmd: string | null = null;

  for (const { text } of lines) {
    const promptMatch = /^\$\s?(.*)$/.exec(text);
    const contMatch = /^>\s?(.*)$/.exec(text);

    if (promptMatch) {
      if (currentCmd !== null) texts.push(currentCmd);
      currentCmd = promptMatch[1]!;
    } else if (contMatch && currentCmd !== null) {
      currentCmd += "\n" + contMatch[1]!;
    } else if (currentCmd !== null) {
      texts.push(text);
    }
  }
  if (currentCmd !== null) texts.push(currentCmd);
  return texts;
}

/** Parse the body lines of a runnable block into ordered interactions. */
function parseInteractions(
  lines: { text: string; line: number }[],
  declarations: IdentityDeclaration[],
  types: TypeRegistry,
  nextAnon: () => string,
  blockLine: number,
): Interaction[] {
  const expanded = expandTypeOnlyBinds(
    collectScanTexts(lines),
    declarations,
    types,
    nextAnon,
    blockLine,
  );

  const interactions: Interaction[] = [];
  let current: Interaction | null = null;

  for (const { text, line } of lines) {
    const promptMatch = /^\$\s?(.*)$/.exec(text);
    const contMatch = /^>\s?(.*)$/.exec(text);

    if (promptMatch) {
      if (current) interactions.push(current);
      current = { command: promptMatch[1]!, expected: [], line };
    } else if (contMatch && current && current.expected.length === 0) {
      current.command += "\n" + contMatch[1]!;
    } else if (current) {
      current.expected.push(text);
    }
  }
  if (current) interactions.push(current);

  return interactions.map((it) => ({
    ...it,
    command: applyIdentities(it.command, expanded),
    expected: it.expected.map((l) => applyIdentities(l, expanded)),
  }));
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Parse a `type:` mapping into normalized regex fragments. */
function parseType(value: unknown, line: number, existing: TypeRegistry): TypeRegistry {
  if (!isPlainObject(value)) {
    throw new Error(`recital type on line ${line} must be a mapping of name → regex string.`);
  }
  const added: TypeRegistry = {};
  for (const [name, pattern] of Object.entries(value)) {
    if (!TYPE_NAME_RE.test(name)) {
      throw new Error(
        `recital type on line ${line} has invalid type name "${name}". Names must match ${TYPE_NAME_RE}.`,
      );
    }
    if (name === "any") {
      throw new Error(`recital type on line ${line} cannot redefine reserved type "any".`);
    }
    if (name in existing || name in added) {
      throw new Error(`recital type on line ${line} redefines type "${name}".`);
    }
    if (typeof pattern !== "string" || !pattern) {
      throw new Error(`recital type "${name}" on line ${line} must be a non-empty regex string.`);
    }
    const normalized = normalizeTypePattern(pattern);
    try {
      new RegExp(normalized);
    } catch (err) {
      throw new Error(
        `recital type "${name}" on line ${line} has invalid regex: ${(err as Error).message}`,
      );
    }
    added[name] = normalized;
  }
  return added;
}

function parseBindEntry(
  entry: unknown,
  line: number,
  nextAnon: () => string,
): IdentityDeclaration {
  if (typeof entry === "string") {
    return { name: nextAnon(), text: entry, anonymous: true };
  }
  if (!isPlainObject(entry)) {
    throw new Error(
      `recital bind entry on line ${line} must be a string or mapping, got ${typeof entry}.`,
    );
  }

  // Explicit: { name?, type?, text }
  if ("text" in entry) {
    const text = entry.text;
    if (typeof text !== "string") {
      throw new Error(`recital bind entry on line ${line} has non-string text.`);
    }
    const name = entry.name;
    if (name !== undefined && typeof name !== "string") {
      throw new Error(`recital bind entry on line ${line} has non-string name.`);
    }
    const type = entry.type;
    if (type !== undefined && typeof type !== "string") {
      throw new Error(`recital bind entry on line ${line} has non-string type.`);
    }
    const unknown = Object.keys(entry).filter((k) => !["name", "type", "text"].includes(k));
    if (unknown.length) {
      throw new Error(
        `recital bind entry on line ${line} has unknown field(s): ${unknown.join(", ")}.`,
      );
    }
    return {
      name: name ?? nextAnon(),
      type,
      text,
      anonymous: name === undefined,
    };
  }

  // Type-only: { type: doc_id } — scan blocks for matches of that type.
  // Exact shape `{ type: <string> }` only (named shorthand `type: "/path"` is
  // ambiguous; use `{ name: type, text: "…" }` for a binding named "type").
  if (Object.keys(entry).length === 1 && typeof entry.type === "string") {
    if (!entry.type) {
      throw new Error(`recital bind entry on line ${line} has empty type.`);
    }
    if (entry.type === "any") {
      throw new Error(
        `recital bind entry on line ${line} cannot use type-only bind with reserved type "any".`,
      );
    }
    return {
      name: nextAnon(),
      type: entry.type,
      anonymous: true,
    };
  }

  // Single-key sugar: name: "…"  or  name: { type, text }
  const keys = Object.keys(entry);
  if (keys.length !== 1) {
    throw new Error(
      `recital bind entry on line ${line} must be a string, { text, … }, { type }, or a single-key name mapping.`,
    );
  }
  const name = keys[0]!;
  const value = entry[name];
  if (typeof value === "string") {
    return { name, text: value, anonymous: false };
  }
  if (isPlainObject(value) && typeof value.text === "string") {
    if (value.type !== undefined && typeof value.type !== "string") {
      throw new Error(`recital bind entry "${name}" on line ${line} has non-string type.`);
    }
    const unknown = Object.keys(value).filter((k) => !["type", "text"].includes(k));
    if (unknown.length) {
      throw new Error(
        `recital bind entry "${name}" on line ${line} has unknown field(s): ${unknown.join(", ")}.`,
      );
    }
    return {
      name,
      type: value.type as string | undefined,
      text: value.text,
      anonymous: false,
    };
  }
  throw new Error(
    `recital bind entry "${name}" on line ${line} must be a string or { type?, text }.`,
  );
}

function parseBind(
  value: unknown,
  line: number,
  nextAnon: () => string,
): IdentityDeclaration[] {
  if (typeof value === "string") {
    return [parseBindEntry(value, line, nextAnon)];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => parseBindEntry(entry, line, nextAnon));
  }
  // Named shorthand: { workdir: "/tmp/x", answer: { type: int, text: "42" } }
  // Also accepts type-only when the mapping is exactly { type: <typename> }.
  if (isPlainObject(value)) {
    if (Object.keys(value).length === 1 && typeof value.type === "string") {
      return [parseBindEntry(value, line, nextAnon)];
    }
    return Object.entries(value).map(([name, v]) =>
      parseBindEntry({ [name]: v }, line, nextAnon),
    );
  }
  throw new Error(
    `recital bind on line ${line} must be a string, a sequence, or a name mapping.`,
  );
}

function parseEnv(value: unknown, line: number): Record<string, string> {
  if (!isPlainObject(value)) {
    throw new Error(`recital env on line ${line} must be a mapping of string values.`);
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      throw new Error(`recital env.${k} on line ${line} must be a scalar string.`);
    }
    env[k] = String(v);
  }
  return env;
}

function parseSessionMapping(
  map: Record<string, unknown>,
  line: number,
  nextAnon: () => string,
  typeRegistry: TypeRegistry,
): {
  directive: RecitalDirective;
  identities: IdentityDeclaration[];
  types: TypeRegistry;
} {
  const unknown = Object.keys(map).filter((k) => !COMMENT_KEYS.has(k));
  if (unknown.length) {
    throw new Error(
      `recital directive on line ${line} has unknown field(s): ${unknown.join(", ")}. ` +
        `Known fields: ${[...COMMENT_KEYS].join(", ")}.`,
    );
  }

  const cmd = map.cmd;
  if (typeof cmd !== "string" || !cmd) {
    throw new Error(`recital directive on line ${line} is missing required field cmd.`);
  }

  let prompt: string | undefined;
  if (map.prompt !== undefined) {
    if (typeof map.prompt !== "string" || !map.prompt) {
      throw new Error(`recital prompt on line ${line} must be a non-empty string.`);
    }
    prompt = map.prompt;
  }

  let syntax: string | undefined;
  if (map.syntax !== undefined) {
    if (typeof map.syntax !== "string") {
      throw new Error(`recital syntax on line ${line} must be a string.`);
    }
    syntax = map.syntax.toLowerCase();
  }

  let pragma: string | undefined;
  if (map.pragma !== undefined) {
    if (typeof map.pragma !== "string") {
      throw new Error(`recital pragma on line ${line} must be a string.`);
    }
    pragma = map.pragma;
  }

  let isolate = false;
  if (map.isolate !== undefined) {
    if (typeof map.isolate !== "boolean") {
      throw new Error(`recital isolate on line ${line} must be a boolean.`);
    }
    isolate = map.isolate;
  }

  let cwd: string | undefined;
  if (map.cwd !== undefined) {
    if (typeof map.cwd !== "string" || !map.cwd) {
      throw new Error(`recital cwd on line ${line} must be a non-empty string (or "temp").`);
    }
    cwd = map.cwd;
  }

  const env = map.env !== undefined ? parseEnv(map.env, line) : undefined;

  let setup: string | undefined;
  if (map.setup !== undefined) {
    if (typeof map.setup !== "string") {
      throw new Error(`recital setup on line ${line} must be a string.`);
    }
    setup = map.setup;
  }

  let teardown: string | undefined;
  if (map.teardown !== undefined) {
    if (typeof map.teardown !== "string") {
      throw new Error(`recital teardown on line ${line} must be a string.`);
    }
    teardown = map.teardown;
  }

  const types =
    map.type !== undefined ? parseType(map.type, line, typeRegistry) : {};

  const identities =
    map.bind !== undefined ? parseBind(map.bind, line, nextAnon) : [];

  return {
    directive: { cmd, prompt, syntax, pragma, isolate, cwd, env, setup, teardown, line },
    identities,
    types,
  };
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
            `(or use a key prefix such as "bind:" or "cmd:").`,
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

function classifyComment(
  map: Record<string, unknown>,
  line: number,
  nextAnon: () => string,
  typeRegistry: TypeRegistry,
):
  | {
      kind: "session";
      directive: RecitalDirective;
      identities: IdentityDeclaration[];
      types: TypeRegistry;
    }
  | { kind: "bind"; identities: IdentityDeclaration[]; types: TypeRegistry }
  | { kind: "type"; types: TypeRegistry } {
  const keys = Object.keys(map);
  if (keys.length === 0) {
    throw new Error(`recital comment on line ${line} is empty.`);
  }

  if ("include" in map) {
    throw new Error(
      `recital include on line ${line} must stand alone and is expanded before ` +
        `parsing — do not combine it with session or bind fields.`,
    );
  }

  const unknown = keys.filter((k) => !COMMENT_KEYS.has(k));
  if (unknown.length) {
    throw new Error(
      `recital comment on line ${line} has unknown field(s): ${unknown.join(", ")}. ` +
        `Known fields: ${[...COMMENT_KEYS].join(", ")}, include.`,
    );
  }

  if ("cmd" in map) {
    return {
      kind: "session",
      ...parseSessionMapping(map, line, nextAnon, typeRegistry),
    };
  }

  const sessionOnly = keys.filter((k) => SESSION_ONLY_KEYS.has(k));
  if (sessionOnly.length) {
    throw new Error(
      `recital comment on line ${line} has session field(s) ${sessionOnly.join(", ")} ` +
        `but no cmd. Use a full mapping that includes cmd, or a "cmd:" prefix comment.`,
    );
  }

  const types =
    map.type !== undefined ? parseType(map.type, line, typeRegistry) : {};
  const identities =
    map.bind !== undefined ? parseBind(map.bind, line, nextAnon) : [];

  if (!("type" in map) && !("bind" in map)) {
    throw new Error(
      `recital comment on line ${line} must declare cmd (session), type, or bind.`,
    );
  }

  if (!("bind" in map)) {
    return { kind: "type", types };
  }

  return { kind: "bind", identities, types };
}

interface RawBlock {
  lang: string;
  pragma: string;
  body: { text: string; line: number }[];
  line: number;
  heading?: string;
  declarations: IdentityDeclaration[];
  types: TypeRegistry;
}

/** Parse a Markdown document into directives and code blocks. */
export function parseMarkdown(source: string, opts: ParseOptions = {}): ParsedDocument {
  const expanded = expandIncludes(source, opts);
  const lines = expanded.split(/\r\n?|\n/);
  const directives: RecitalDirective[] = [];
  const rawBlocks: RawBlock[] = [];

  let lastHeading: string | undefined;
  const declarations: IdentityDeclaration[] = [];
  let typeRegistry: TypeRegistry = {};
  let anonCount = 0;
  const nextAnon = () => `__recital_anon_${anonCount++}`;
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i]!;
    const fence = FENCE_RE.exec(raw);

    if (!fence) {
      if (RECITAL_OPEN_RE.test(raw)) {
        const { map, endIdx, line } = readRecitalComment(lines, i);
        const classified = classifyComment(map, line, nextAnon, typeRegistry);
        if (Object.keys(classified.types).length) {
          typeRegistry = { ...typeRegistry, ...classified.types };
        }
        if (classified.kind === "session") {
          declarations.push(...classified.identities);
          directives.push(classified.directive);
        } else if (classified.kind === "bind") {
          declarations.push(...classified.identities);
        }
        i = endIdx + 1;
        continue;
      }
      const heading = HEADING_RE.exec(raw);
      if (heading) lastHeading = heading[1];
      i++;
      continue;
    }

    const [, indent, marker, info] = fence;
    const { lang, pragma } = parseFenceInfo(info!);
    const openLine = i + 1;
    const closeRe = new RegExp(`^\\s*${marker![0]}{${marker!.length},}\\s*$`);

    const body: { text: string; line: number }[] = [];
    i++;
    while (i < lines.length && !closeRe.test(lines[i]!)) {
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
      types: { ...typeRegistry },
    });
  }

  const blocks: Block[] = rawBlocks.map((rb) => ({
    lang: rb.lang,
    pragma: rb.pragma,
    interactions: parseInteractions(
      rb.body,
      rb.declarations,
      rb.types,
      nextAnon,
      rb.line,
    ),
    line: rb.line,
    heading: rb.heading,
    directive: matchDirective(rb.lang, rb.pragma, directives, rb.line),
    types: rb.types,
  }));

  return { path: opts.path ?? "<inline>", directives, blocks };
}
