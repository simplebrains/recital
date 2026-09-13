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
      ["<!-- recital cmd=bash -->", "```console", "$ echo hello", "hello", "```"].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("does not run blocks without a matching directive", async () => {
    const result = await runDocument(
      [
        "<!-- recital syntax=console cmd=bash -->",
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
    // `false` exits non-zero but produces no output; recital only checks output.
    const result = await runDocument(
      ["<!-- recital cmd=bash -->", "```console", "$ false", "```"].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("fails on a mismatch and explains it", async () => {
    const result = await runDocument(
      ["<!-- recital cmd=bash -->", "```console", "$ echo hello", "goodbye", "```"].join("\n"),
    );
    expect(result.ok).toBe(false);
    expect(result.blocks[0]!.interactions[0]!.error).toContain("did not match");
  });

  it("captures a value and reuses it in a later command and expectation", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd=bash -->",
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

  it("captures and reuses a value declared via a named identity comment", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd=bash -->",
        '<!-- n "12345" -->',
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

  it("captures and reuses a value declared via an anonymous identity comment", async () => {
    const result = await runDocument(
      [
        "<!-- recital cmd=bash -->",
        '<!-- "12345" -->',
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
        '<!-- recital syntax=console cmd=bash pragma="A" -->',
        '<!-- recital syntax=console cmd=bash pragma="B" -->',
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
        "<!-- recital syntax=console cmd=bash isolate -->",
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

  it("propagates a parse error for an ambiguous block", async () => {
    await expect(
      runDocument(
        [
          "<!-- recital cmd=bash -->",
          "<!-- recital syntax=console cmd=bash -->",
          "```console",
          "$ true",
          "```",
        ].join("\n"),
      ),
    ).rejects.toThrow(/multiple recital directives/);
  });
});
