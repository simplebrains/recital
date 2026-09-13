/**
 * Shared type definitions for recital.
 */

/** A single command + its expected output, as parsed from a `console` block. */
export interface Interaction {
  /** The command line to send to the shell (without the leading `$ `). */
  command: string;
  /**
   * The expected-output template lines that follow the command in the block.
   * Empty array means "don't care about output" (only the command is run).
   */
  expected: string[];
  /** 1-based line number of the command within the source document. */
  line: number;
}

/** A single `console` (or otherwise runnable) fenced code block. */
export interface Block {
  /** The info string after the opening fence, e.g. `console`. */
  lang: string;
  /** Key/value options parsed from the fence info string, e.g. ```console cwd=/tmp */
  options: Record<string, string>;
  /** The interactions contained in the block, in order. */
  interactions: Interaction[];
  /** 1-based line number of the opening fence. */
  line: number;
  /**
   * The nearest preceding Markdown heading text, if any — used to name tests.
   */
  heading?: string;
}

/** A parsed Markdown document. */
export interface ParsedDocument {
  /** Absolute or relative path the document was read from (or a label). */
  path: string;
  /** All runnable blocks found in the document. */
  blocks: Block[];
}

/** The set of matcher token type names understood in expectation templates. */
export type TokenType =
  | "any"
  | "id"
  | "uuid"
  | "int"
  | "number"
  | "word"
  | "path"
  | "port"
  | "timestamp"
  | "hex"
  | "email";

/** Result of matching one expected line against one actual line. */
export interface LineMatch {
  ok: boolean;
  /** New/confirmed bindings captured on this line. */
  captures: Record<string, string>;
}

/** Outcome of running a single interaction. */
export interface InteractionResult {
  interaction: Interaction;
  /** The command after binding substitution, as actually executed. */
  executed: string;
  ok: boolean;
  exitCode: number;
  /** Combined stdout+stderr, in order. */
  output: string;
  /** Human-readable failure explanation, present when `ok` is false. */
  error?: string;
}

/** Outcome of running one block. */
export interface BlockResult {
  block: Block;
  ok: boolean;
  interactions: InteractionResult[];
}

/** Outcome of running a whole document. */
export interface DocumentResult {
  path: string;
  ok: boolean;
  blocks: BlockResult[];
}
