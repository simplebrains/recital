import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/parser.js";
import { Runner, runDocument } from "../src/runner.js";
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
      ["```console", "$ echo hello", "hello", "```"].join("\n"),
    );
    expect(result.ok).toBe(true);
  });

  it("fails on a mismatch and explains it", async () => {
    const result = await runDocument(
      ["```console", "$ echo hello", "goodbye", "```"].join("\n"),
    );
    expect(result.ok).toBe(false);
    const failed = result.blocks[0]!.interactions[0]!;
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("did not match");
  });

  it("captures a value and reuses it in a later command and expectation", async () => {
    const result = await runDocument(
      [
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

  it("asserts exit codes when expectSuccess is set", async () => {
    const result = await runDocument(["```console", "$ false", "```"].join("\n"), {
      expectSuccess: true,
    });
    expect(result.ok).toBe(false);
    expect(result.blocks[0]!.interactions[0]!.error).toContain("exit code 0");
  });

  it("honours a block-level exit= override", async () => {
    const result = await runDocument(["```console exit=1", "$ false", "```"].join("\n"), {
      expectSuccess: true,
    });
    expect(result.ok).toBe(true);
  });

  it("captures and reuses a value declared via a named identity comment", async () => {
    const result = await runDocument(
      [
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

  it("skips blocks marked skip", async () => {
    const parsed = parseMarkdown(["```console skip", "$ definitely-not-a-command", "```"].join("\n"));
    const runner = new Runner();
    try {
      const block = await runner.runBlock(parsed.blocks[0]!);
      expect(block.ok).toBe(true);
      expect(block.interactions).toHaveLength(0);
    } finally {
      await runner.close();
    }
  });
});
