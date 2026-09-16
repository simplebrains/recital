import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runDocument } from "../src/runner.js";
import { PromptSession } from "../src/shell.js";

// A prompt-mode session drives an interactive REPL by watching for its prompt to
// reappear, rather than injecting a bash sentinel — so recital can drive a
// program that reads its own stdin. The fixture REPL prints "calc> " and
// evaluates each line as JavaScript.
const REPL = fileURLToPath(new URL("./fixtures/repl.cjs", import.meta.url));
const CMD = `node ${REPL}`;

describe("PromptSession", () => {
  it("drives a REPL, syncing on its prompt", async () => {
    const session = new PromptSession({ shell: CMD, prompt: "calc> " });
    try {
      expect((await session.run("1 + 1")).output.trim()).toBe("2");
      expect((await session.run("6 * 7")).output.trim()).toBe("42");
    } finally {
      await session.close();
    }
  });

  it("keeps state across commands in one session", async () => {
    const session = new PromptSession({ shell: CMD, prompt: "calc> " });
    try {
      await session.run("globalThis.n = 41");
      expect((await session.run("n + 1")).output.trim()).toBe("42");
    } finally {
      await session.close();
    }
  });

  it("returns empty output for a command that prints nothing before the prompt", async () => {
    const session = new PromptSession({ shell: CMD, prompt: "calc> " });
    try {
      // `undefined` stringifies to "undefined"; use a statement whose value is "".
      expect((await session.run('""')).output.trim()).toBe("");
    } finally {
      await session.close();
    }
  });
});

describe("prompt-mode documents", () => {
  it("runs an interactive REPL transcript verbatim", async () => {
    const doc = [
      `<!-- recital: { cmd: "${CMD}", prompt: "calc> " } -->`,
      "```console",
      "$ 1 + 1",
      "2",
      "$ 40 + 2",
      "42",
      "```",
    ].join("\n");
    const result = await runDocument(doc);
    expect(result.ok).toBe(true);
  });

  it("reports a mismatch like any other session", async () => {
    const doc = [
      `<!-- recital: { cmd: "${CMD}", prompt: "calc> " } -->`,
      "```console",
      "$ 2 + 2",
      "5",
      "```",
    ].join("\n");
    const result = await runDocument(doc);
    expect(result.ok).toBe(false);
  });

  it("runs a bash `setup` before the REPL and shares its working directory", async () => {
    const doc = [
      "<!-- recital:",
      `cmd: "${CMD}"`,
      'prompt: "calc> "',
      "cwd: temp",
      "setup: |",
      // Also emit to stderr: setup output and the REPL prompt must stay on one
      // ordered stream, or the initial-prompt drain never ends (a sync hang).
      '  echo "preparing…" >&2',
      "  echo hello > greeting.txt",
      "-->",
      "```console",
      "$ require('fs').readFileSync('greeting.txt','utf8').trim()",
      "hello",
      "```",
    ].join("\n");
    const result = await runDocument(doc);
    expect(result.ok).toBe(true);
  });
});
