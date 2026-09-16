/**
 * recital — run Markdown files that describe CLI sessions, as executable and
 * verifiable tests.
 */

export {
  parseMarkdown,
  type ParseOptions,
  type IdentityDeclaration,
} from "./parser.js";
export {
  expandIncludes,
  type ExpandIncludesOptions,
} from "./include.js";
export {
  compileLine,
  matchLine,
  matchBlock,
  normalizeOutput,
  normalizeTypePattern,
  resolveTypePattern,
  stripAnsi,
  substituteBindings,
  ANY_PATTERN,
  type Bindings,
  type BlockMatchResult,
  type NormalizeOptions,
  type TypeRegistry,
} from "./matcher.js";
export { ShellSession, type ShellOptions, type CommandResult } from "./shell.js";
export {
  Runner,
  DirectiveSession,
  runDocument,
  runParsedDocument,
  type RunnerOptions,
} from "./runner.js";
export type {
  Block,
  BlockResult,
  DocumentResult,
  Interaction,
  InteractionResult,
  LineMatch,
  ParsedDocument,
  RecitalDirective,
} from "./types.js";
