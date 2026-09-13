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
  compileLine,
  matchLine,
  matchBlock,
  normalizeOutput,
  stripAnsi,
  substituteBindings,
  type Bindings,
  type BlockMatchResult,
  type NormalizeOptions,
} from "./matcher.js";
export { ShellSession, type ShellOptions, type CommandResult } from "./shell.js";
export {
  Runner,
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
  TokenType,
} from "./types.js";
