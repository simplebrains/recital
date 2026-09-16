import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runDocument } from "../src/runner.js";
import { ShellSession } from "../src/shell.js";

describe("ShellSession", () => {
  it("runs commands and reports exit codes", async () => {
    const shell = new ShellSession();
    try {
      expect(await shell.run("echo hello")).toMatchObject({
        output: expect.stringContaining("hello"),
        exitCode: 0,
      });
      expect((await shell.run("false")).exitCode).toBe(1);
    } finally {
      await shell.close();
    }
  });

  it("persists working directory and environment across commands", async () => {
    const shell = new ShellSession();
    try {
      await shell.run("cd /");
      expect((await shell.run("pwd")).output).toContain("/");
      await shell.run("export RECITAL_TEST=abc");
      expect((await shell.run("echo $RECITAL_TEST")).output).toContain("abc");
    } finally {
      await shell.close();
    }
  });

  it("merges stderr into stdout in order", async () => {
    const shell = new ShellSession();
    try {
      const r = await shell.run("echo out; echo err 1>&2");
      expect(r.output).toContain("out");
      expect(r.output).toContain("err");
    } finally {
      await shell.close();
    }
  });
});

describe("runDocument", () => {
  it("passes a matching session", async () => {
    const result = await runDocument(
      ["<!-- recital cmd: bash -->", "```console", "$ echo hello", "hello", "```"].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("does not run blocks without a matching directive", async () => {
    const result = await runDocument(
      [
        "<!-- recital: { cmd: bash, syntax: console } -->",
        "```console",
        "$ echo hi",
        "hi",
        "```",
        "```js",
        "definitely not a command",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(1);
  });

  it("asserts output, not exit status", async () => {
    const result = await runDocument(
      ["<!-- recital cmd: bash -->", "```console", "$ false", "```"].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("fails on a mismatch and explains it", async () => {
    const result = await runDocument(
      ["<!-- recital cmd: bash -->", "```console", "$ echo hello", "goodbye", "```"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.blocks[0]!.interactions[0]!.error).toContain("did not match");
  });

  it("captures a value and reuses it in a later command and expectation", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd: bash -->",
        '<!-- recital type: { int: "-?\\\\d+" } -->',
        "```console",
        "$ echo token-12345",
        "token-{{id:int}}",
        '$ echo "again {{id}}"',
        "again {{id}}",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("discovers identities via type-only bind", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd: bash -->",
        '<!-- recital type: { doc_id: "d_[a-z0-9]{7}" } -->',
        "<!-- recital bind: { type: doc_id } -->",
        "```console",
        "$ printf 'd_%s\\n' 9f4k2qa 3xb7m0c 9f4k2qa",
        "d_9f4k2qa",
        "d_3xb7m0c",
        "d_9f4k2qa",
        '$ echo "first was d_9f4k2qa; second was d_3xb7m0c"',
        "first was d_9f4k2qa; second was d_3xb7m0c",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("captures and reuses a value declared via a named bind", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd: bash -->",
        '<!-- recital bind: n: "12345" -->',
        "```console",
        "$ echo $RANDOM",
        "12345",
        '$ echo "n is 12345"',
        "n is 12345",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("captures and reuses a value declared via an anonymous bind", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd: bash -->",
        '<!-- recital bind: "12345" -->',
        "```console",
        "$ echo $RANDOM",
        "12345",
        '$ echo "seen 12345"',
        "seen 12345",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("keeps per-session state across interleaved sessions, in document order", async () => {
    const result = await runDocument(
      [
        '<!-- recital: { cmd: bash, syntax: console, pragma: "A" } -->',
        '<!-- recital: { cmd: bash, syntax: console, pragma: "B" } -->',
        "```console A",
        "$ X=1",
        "```",
        "```console B",
        "$ X=99",
        '$ echo "$X"',
        "99",
        "```",
        "```console A",
        '$ echo "$X"',
        "1",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    expect(result.blocks).toHaveLength(3);
  });

  it("isolate gives each block a fresh session", async () => {
    const result = await runDocument(
      [
        "<!-- recital: { cmd: bash, syntax: console, isolate: true } -->",
        "```console",
        "$ X=1",
        '$ echo "$X"',
        "1",
        "```",
        "```console",
        '$ echo "${X:-unset}"',
        "unset",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("cwd: temp starts in a host-managed directory that is removed afterward", async () => {
    const marker = join(await mkdtemp(join(tmpdir(), "recital-marker-")), "seen");
    const result = await runDocument(
      [
        "<!-- recital:",
        "cmd: bash",
        "cwd: temp",
        "setup: |",
        `  printf '%s' "$PWD" > ${marker}`,
        "-->",
        "```console",
        "$ test -f note.txt || touch note.txt",
        "$ ls",
        "note.txt",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    const dir = await readFile(marker, "utf8");
    await expect(access(dir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("injects env and runs teardown", async () => {
    const flag = join(await mkdtemp(join(tmpdir(), "recital-td-")), "torn-down");
    const result = await runDocument(
      [
        "<!-- recital:",
        "cmd: bash",
        "env:",
        "  RECITAL_GREETING: howdy",
        "teardown: |",
        `  touch ${flag}`,
        "-->",
        "```console",
        "$ echo \"$RECITAL_GREETING\"",
        "howdy",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(true);
    await expect(access(flag)).resolves.toBeUndefined();
  });

  it("runs teardown after a failed assertion", async () => {
    const flag = join(await mkdtemp(join(tmpdir(), "recital-td-fail-")), "torn-down");
    const result = await runDocument(
      [
        "<!-- recital:",
        "cmd: bash",
        "teardown: |",
        `  touch ${flag}`,
        "-->",
        "```console",
        "$ echo hello",
        "goodbye",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    await expect(access(flag)).resolves.toBeUndefined();
  });

  it("runs teardown after a failed isolate block", async () => {
    const flag = join(await mkdtemp(join(tmpdir(), "recital-td-iso-")), "torn-down");
    const result = await runDocument(
      [
        "<!-- recital:",
        "cmd: bash",
        "isolate: true",
        "teardown: |",
        `  touch ${flag}`,
        "-->",
        "```console",
        "$ echo hello",
        "goodbye",
        "```",
      ].join("\n"),
    );
    expect(result.ok).toBe(false);
    await expect(access(flag)).resolves.toBeUndefined();
  });

  it("propagates a parse error for an ambiguous block", async () => {
    await expect(
      runDocument(
        [
          "<!-- recital cmd: bash -->",
          "<!-- recital: { cmd: bash, syntax: console } -->",
          "```console",
          "$ true",
          "```",
        ].join("\n"),
      ),
    ).rejects.toThrow(/multiple recital directives/);
  });
});
