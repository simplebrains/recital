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

export class ShellSession {
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
