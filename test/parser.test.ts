import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/parser.js";

describe("parseMarkdown", () => {
  it("extracts console blocks and ignores other code", () => {
    const doc = parseMarkdown(
      [
        "# Title",
        "",
        "```js",
        "not a session",
        "```",
        "",
        "```console",
        "$ echo hi",
        "hi",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.interactions).toEqual([
      { command: "echo hi", expected: ["hi"], line: 8 },
    ]);
  });

  it("associates the nearest heading with a block", () => {
    const doc = parseMarkdown(["## Do a thing", "```console", "$ true", "```"].join("\n"));
    expect(doc.blocks[0]!.heading).toBe("Do a thing");
  });

  it("splits multiple interactions in one block", () => {
    const doc = parseMarkdown(
      ["```console", "$ echo a", "a", "$ echo b", "b", "```"].join("\n"),
    );
    const cmds = doc.blocks[0]!.interactions.map((i) => i.command);
    expect(cmds).toEqual(["echo a", "echo b"]);
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["a"]);
  });

  it("joins secondary-prompt continuation lines into the command", () => {
    const doc = parseMarkdown(
      ["```console", "$ echo one \\", "> two", "one two", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.command).toBe("echo one \\\ntwo");
  });

  it("parses fence options", () => {
    const doc = parseMarkdown(
      ['```console cwd="/tmp" exit=1 skip', "$ false", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.options).toEqual({ cwd: "/tmp", exit: "1", skip: "true" });
  });

  it("handles indented fences and tilde fences", () => {
    const doc = parseMarkdown(
      ["- item", "  ~~~console", "  $ echo x", "  x", "  ~~~"].join("\n"),
    );
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]!.interactions[0]).toMatchObject({ command: "echo x", expected: ["x"] });
  });

  it("records a command with no expected output", () => {
    const doc = parseMarkdown(["```console", "$ cd /tmp", "$ pwd", "/tmp", "```"].join("\n"));
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual([]);
  });

  it("rewrites a named identity comment into binding tokens", () => {
    const doc = parseMarkdown(
      [
        '<!-- workdir "/tmp/x" -->',
        "```console",
        "$ pwd",
        "/tmp/x",
        "$ echo /tmp/x",
        "/tmp/x",
        "```",
      ].join("\n"),
    );
    const [pwd, echo] = doc.blocks[0]!.interactions;
    expect(pwd!.expected).toEqual(["{{workdir}}"]);
    expect(echo!.command).toBe("echo {{workdir}}");
    expect(echo!.expected).toEqual(["{{workdir}}"]);
  });

  it("rewrites an anonymous identity comment into a synthetic binding token", () => {
    const doc = parseMarkdown(
      [
        '<!-- "/tmp/x" -->',
        "```console",
        "$ pwd",
        "/tmp/x",
        "$ echo /tmp/x",
        "/tmp/x",
        "```",
      ].join("\n"),
    );
    const [pwd, echo] = doc.blocks[0]!.interactions;
    // Every occurrence rewrites to the *same* synthetic token, so they all
    // resolve to one identity at match time.
    expect(pwd!.expected).toEqual(["{{__recital_anon_0}}"]);
    expect(echo!.command).toBe("echo {{__recital_anon_0}}");
    expect(echo!.expected).toEqual(["{{__recital_anon_0}}"]);
  });

  it("supports a typed named identity declaration", () => {
    const doc = parseMarkdown(
      ['<!-- id:uuid "the-id" -->', "```console", "$ echo x", "the-id", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["{{id:uuid}}"]);
  });

  it("supports a typed anonymous identity declaration", () => {
    const doc = parseMarkdown(
      ['<!-- :path "/tmp/x" -->', "```console", "$ pwd", "/tmp/x", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["{{__recital_anon_0:path}}"]);
  });

  it("gives each anonymous identity its own synthetic binding", () => {
    const doc = parseMarkdown(
      [
        '<!-- "/tmp/a" -->',
        '<!-- "/tmp/b" -->',
        "```console",
        "$ echo /tmp/a /tmp/b",
        "/tmp/a /tmp/b",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual([
      "{{__recital_anon_0}} {{__recital_anon_1}}",
    ]);
  });

  it("ignores ordinary HTML comments with no quoted value", () => {
    const doc = parseMarkdown(
      ["<!-- just a note -->", "```console", "$ echo hi", "hi", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["hi"]);
  });

  it("only applies an identity declaration to blocks that follow it", () => {
    const doc = parseMarkdown(
      [
        "```console",
        "$ echo /tmp/x",
        "/tmp/x",
        "```",
        '<!-- workdir "/tmp/x" -->',
        "```console",
        "$ echo /tmp/x",
        "/tmp/x",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["/tmp/x"]);
    expect(doc.blocks[1]!.interactions[0]!.expected).toEqual(["{{workdir}}"]);
  });
});
