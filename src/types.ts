/**
 * Shared type definitions for recital.
 */

/**
 * A `<!-- recital … -->` session directive: configures a session and selects
 * which fenced code blocks it owns.
 */
export interface RecitalDirective {
  /** The command used to drive the session (e.g. `bash`). Required. */
  cmd: string;
  /** Only match blocks whose fence language equals this, if set. */
  syntax?: string;
  /** Only match blocks whose fence pragma contains this substring, if set. */
  pragma?: string;
  /**
   * When true, every matching block runs in its own fresh session. Otherwise
   * all blocks matching this directive share one persistent session.
   */
  isolate: boolean;
  /**
   * Session working directory. `"temp"` means a host-managed temporary
   * directory created for the session and removed when it ends; any other
   * string is used as a path.
   */
  cwd?: string;
  /** Extra environment variables injected into the session. */
  env?: Record<string, string>;
  /** Shell snippet run once when the session starts. */
  setup?: string;
  /** Shell snippet always run when the session ends (before the shell exits). */
  teardown?: string;
  /** 1-based line number of the directive comment in the source document. */
  line: number;
}

/** A single command + its expected output, as parsed from a runnable block. */
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

/** A single fenced code block found in the Markdown document. */
export interface Block {
  /** The fence language (first token of the info string), e.g. `console`. */
  lang: string;
  /** The fence pragma: the info-string text following the language token. */
  pragma: string;
  /** The interactions contained in the block, in order. */
  interactions: Interaction[];
  /** 1-based line number of the opening fence. */
  line: number;
  /**
   * The nearest preceding Markdown heading text, if any — used to name tests.
   */
  heading?: string;
  /**
   * The directive that owns this block, if exactly one matches. Blocks with no
   * matching directive are not interpreted by recital.
   */
  directive?: RecitalDirective;
}

/** A parsed Markdown document. */
export interface ParsedDocument {
  /** Absolute or relative path the document was read from (or a label). */
  path: string;
  /** The recital session directives declared in the document, in order. */
  directives: RecitalDirective[];
  /** Every fenced code block found in the document, in order. */
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
  /** The command's exit code (informational; not asserted). */
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
