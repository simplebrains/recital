/**
 * A persistent shell session.
 *
 * A CLI "session" implies state that survives between commands — the working
 * directory, exported variables, shell functions. So rather than spawning a
 * fresh process per command, we keep one shell alive and feed it commands over
 * stdin.
 *
 * To recover per-command output and exit status from a single long-lived
 * stream we (1) redirect the shell's stderr onto stdout once at startup
 * (`exec 2>&1`) so output stays in program order, and (2) print a random
 * sentinel plus `$?` after each command, reading stdout until the sentinel
 * appears.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";

export interface ShellOptions {
  /** Shell executable. Default: `bash` (resolved to an absolute path when possible). */
  shell?: string;
  /** Initial working directory. Default: `process.cwd()`. */
  cwd?: string;
  /** Environment variables (merged over the current process env). */
  env?: Record<string, string | undefined>;
}

export interface CommandResult {
  output: string;
  exitCode: number;
}

/**
 * The behaviour the runner needs from any session: feed it a command, get back
 * that command's output; and close it down. {@link ShellSession} drives a
 * bash-like shell with an injected sentinel; {@link PromptSession} drives an
 * interactive REPL and syncs on its prompt.
 */
export interface Session {
  run(command: string): Promise<CommandResult>;
  close(): Promise<void>;
}

interface Pending {
  re: RegExp;
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
}

/**
 * Resolve a bare shell name to a real executable. On some macOS setups PATH
 * contains text stubs (e.g. `/usr/local/bin/bash` → a Homebrew path) that
 * spawn as ENOEXEC; prefer well-known absolute locations for `bash`.
 */
function resolveShell(shell: string): string {
  if (shell.includes("/") || shell.includes("\\")) return shell;
  if (shell === "bash") {
    for (const candidate of ["/bin/bash", "/usr/bin/bash"]) {
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // try next
      }
    }
  }
  return shell;
}

export class ShellSession implements Session {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending: Pending | null = null;
  private closed = false;
  private exitError: Error | null = null;

  constructor(opts: ShellOptions = {}) {
    const shell = resolveShell(opts.shell ?? "bash");
    const env = { ...process.env, ...opts.env } as NodeJS.ProcessEnv;
    this.proc = spawn(shell, [], {
      cwd: opts.cwd ?? process.cwd(),
      env,
      stdio: "pipe",
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.proc.stderr.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.proc.on("error", (err) => {
      this.exitError = err;
      this.failPending(err);
    });
    this.proc.on("exit", (code, signal) => {
      this.closed = true;
      if (this.pending) {
        this.failPending(
          new Error(`Shell exited unexpectedly (code=${code}, signal=${signal}).`),
        );
      }
    });

    // Merge stderr into stdout for ordered output, and keep the prompt quiet.
    this.proc.stdin.write("exec 2>&1\n");
    this.proc.stdin.write("PS1=''; PS2=''\n");
  }

  private onData(text: string): void {
    this.buffer += text;
    this.tryResolve();
  }

  private failPending(err: Error): void {
    const p = this.pending;
    if (p) {
      this.pending = null;
      p.reject(err);
    }
  }

  private tryResolve(): void {
    if (!this.pending) return;
    const m = this.pending.re.exec(this.buffer);
    if (!m) return;
    const output = this.buffer.slice(0, m.index);
    const exitCode = Number.parseInt(m[1]!, 10);
    this.buffer = this.buffer.slice(m.index + m[0].length);
    const p = this.pending;
    this.pending = null;
    p.resolve({ output, exitCode });
  }

  /** Run a command and resolve with its combined output and exit code. */
  run(command: string): Promise<CommandResult> {
    if (this.closed) {
      return Promise.reject(this.exitError ?? new Error("Shell session is closed."));
    }
    if (this.pending) {
      return Promise.reject(new Error("A command is already in flight on this session."));
    }
    const sentinel = `__RECITAL_${randomBytes(12).toString("hex")}__`;
    const re = new RegExp(`\\n?${sentinel} (\\d+)\\r?\\n`);
    return new Promise<CommandResult>((resolve, reject) => {
      this.pending = { re, resolve, reject };
      this.proc.stdin.write(command + "\n");
      // A leading newline guarantees the sentinel starts its own line even if
      // the command's output had no trailing newline.
      this.proc.stdin.write(`printf '\\n%s %s\\n' "${sentinel}" "$?"\n`);
    });
  }

  /** Terminate the shell session. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    return new Promise<void>((resolve) => {
      this.proc.once("exit", () => resolve());
      try {
        this.proc.stdin.end("exit\n");
      } catch {
        this.proc.kill();
        resolve();
        return;
      }
      // Safety net if the shell ignores `exit`.
      const timer = setTimeout(() => {
        this.proc.kill();
        resolve();
      }, 2000);
      this.proc.once("exit", () => clearTimeout(timer));
    });
  }
}

export interface PromptSessionOptions extends ShellOptions {
  /** The prompt string the driven program prints when it is ready for input. */
  prompt: string;
  /**
   * Optional bash snippet run once before the REPL is launched — useful for
   * building the working tree / environment the REPL then runs in. It executes
   * in a bash that `exec`s into `cmd`, so its `cd`/`export`s carry into the REPL.
   */
  setup?: string;
}

/**
 * Drive an interactive REPL by its prompt.
 *
 * Unlike {@link ShellSession}, which injects a bash-specific sentinel after each
 * command, this launches the program as a real REPL and treats the **prompt
 * reappearing** as the end-of-output signal — the only assumption that holds for
 * an arbitrary program reading its own stdin (a Python/Node/omgbase shell, …).
 *
 * The program is launched via `bash -c 'exec 2>&1; <setup>; exec <cmd>'`:
 * `exec 2>&1` folds stderr into stdout up front so setup output and the REPL's
 * output (many REPLs print the prompt to stderr) stay on one ordered stream;
 * `setup` (if any) then runs; then bash is *replaced* by the REPL so recital's
 * stdin pipe feeds it directly. Some shells echo the line they read on a pipe; a
 * leading echoed copy of the command is stripped from the output.
 */
export class PromptSession implements Session {
  private proc: ChildProcessWithoutNullStreams;
  private buffer = "";
  private readonly prompt: string;
  private ready = false;
  private readyWaiters: Array<() => void> = [];
  private pending:
    | { command: string; resolve: (r: CommandResult) => void; reject: (e: Error) => void }
    | null = null;
  private closed = false;
  private exitError: Error | null = null;

  constructor(opts: PromptSessionOptions) {
    this.prompt = opts.prompt;
    const bash = resolveShell("bash");
    const cmd = opts.shell ?? "bash";
    // `exec 2>&1` first so that *everything* after it — the setup snippet's
    // output and the REPL's — lands on one ordered stream (stdout). Without it,
    // setup's stderr and the REPL's stdout are separate OS pipes that can arrive
    // out of order, and the buffer may not end with the prompt (a sync hang).
    const wrapper = `exec 2>&1\n${opts.setup ? opts.setup + "\n" : ""}exec ${cmd}`;
    const env = { ...process.env, ...opts.env } as NodeJS.ProcessEnv;
    this.proc = spawn(bash, ["-c", wrapper], {
      cwd: opts.cwd ?? process.cwd(),
      env,
      stdio: "pipe",
    });

    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.proc.stderr.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    this.proc.on("error", (err) => {
      this.exitError = err;
      this.failPending(err);
    });
    this.proc.on("exit", (code, signal) => {
      this.closed = true;
      if (this.pending) {
        this.failPending(
          new Error(`REPL exited unexpectedly (code=${code}, signal=${signal}).`),
        );
      }
    });
  }

  private onData(text: string): void {
    this.buffer += text;
    if (!this.ready) {
      // Drain the startup banner and the first prompt.
      if (this.buffer.endsWith(this.prompt)) {
        this.ready = true;
        this.buffer = "";
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const w of waiters) w();
      }
      return;
    }
    this.tryResolve();
  }

  private tryResolve(): void {
    const p = this.pending;
    if (!p) return;
    // The prompt reappears (with nothing after it) once the REPL has finished
    // this command's output and is blocking on the next line.
    if (!this.buffer.endsWith(this.prompt)) return;
    const raw = this.buffer.slice(0, this.buffer.length - this.prompt.length);
    this.buffer = "";
    this.pending = null;
    p.resolve({ output: stripEchoedCommand(raw, p.command), exitCode: 0 });
  }

  private failPending(err: Error): void {
    const p = this.pending;
    if (p) {
      this.pending = null;
      p.reject(err);
    }
  }

  private whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve) => this.readyWaiters.push(resolve));
  }

  /** Send a command line to the REPL and resolve with its output. */
  async run(command: string): Promise<CommandResult> {
    if (this.closed) {
      throw this.exitError ?? new Error("REPL session is closed.");
    }
    if (this.pending) {
      throw new Error("A command is already in flight on this session.");
    }
    await this.whenReady();
    return new Promise<CommandResult>((resolve, reject) => {
      this.pending = { command, resolve, reject };
      this.proc.stdin.write(command + "\n");
      // Data may already be buffered from an eager REPL.
      this.tryResolve();
    });
  }

  /** Close the REPL by ending its stdin (EOF); kill it if it lingers. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    return new Promise<void>((resolve) => {
      this.proc.once("exit", () => resolve());
      try {
        this.proc.stdin.end();
      } catch {
        this.proc.kill();
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.proc.kill();
        resolve();
      }, 2000);
      this.proc.once("exit", () => clearTimeout(timer));
    });
  }
}

/**
 * Some interactive shells echo back the line they read when stdin is a pipe
 * (e.g. `bash -i`). Drop a single leading line identical to the command so the
 * asserted output is just the program's response.
 */
function stripEchoedCommand(output: string, command: string): string {
  const firstLineEnd = output.indexOf("\n");
  const firstLine = firstLineEnd === -1 ? output : output.slice(0, firstLineEnd);
  if (firstLine === command) {
    return firstLineEnd === -1 ? "" : output.slice(firstLineEnd + 1);
  }
  return output;
}
