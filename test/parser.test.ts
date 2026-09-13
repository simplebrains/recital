import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/parser.js";

describe("parseMarkdown", () => {
  it("records every code block with its language and pragma", () => {
    const doc = parseMarkdown(
      ["```console a pragma", "$ echo hi", "hi", "```", "```js", "code", "```"].join("\n"),
    );
    expect(doc.blocks).toHaveLength(2);
    expect(doc.blocks[0]).toMatchObject({ lang: "console", pragma: "a pragma" });
    expect(doc.blocks[1]).toMatchObject({ lang: "js", pragma: "" });
  });

  it("interprets nothing without a directive", () => {
    const doc = parseMarkdown(["```console", "$ echo hi", "hi", "```"].join("\n"));
    expect(doc.directives).toEqual([]);
    expect(doc.blocks[0]!.directive).toBeUndefined();
  });

  it("a cmd-only directive owns every code block", () => {
    const doc = parseMarkdown(
      ["<!-- recital cmd=bash -->", "```console", "$ echo hi", "hi", "```"].join("\n"),
    );
    expect(doc.directives[0]).toMatchObject({ cmd: "bash", isolate: false });
    expect(doc.blocks[0]!.directive).toBe(doc.directives[0]);
  });

  it("a syntax= directive owns only blocks of that language", () => {
    const doc = parseMarkdown(
      [
        "<!-- recital syntax=console cmd=bash -->",
        "```console",
        "$ echo hi",
        "hi",
        "```",
        "```js",
        "not run",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.directive).toBe(doc.directives[0]);
    expect(doc.blocks[1]!.directive).toBeUndefined();
  });

  it("a pragma= directive owns only blocks whose pragma contains the text", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital pragma="Bob logs in" cmd=bash -->',
        "```console Bob logs in and does a thing",
        "$ true",
        "```",
        "```console someone else",
        "$ true",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.directive).toBe(doc.directives[0]);
    expect(doc.blocks[1]!.directive).toBeUndefined();
  });

  it("parses the isolate flag", () => {
    const doc = parseMarkdown(["<!-- recital cmd=bash isolate -->"].join("\n"));
    expect(doc.directives[0]).toMatchObject({ cmd: "bash", isolate: true });
  });

  it("assigns interleaved blocks to their own directive", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital syntax=console cmd=bash pragma="A" -->',
        '<!-- recital syntax=console cmd=bash pragma="B" -->',
        "```console A",
        "$ true",
        "```",
        "```console B",
        "$ true",
        "```",
        "```console A",
        "$ true",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks.map((b) => b.directive)).toEqual([
      doc.directives[0],
      doc.directives[1],
      doc.directives[0],
    ]);
  });

  it("throws when a directive is missing cmd=", () => {
    expect(() => parseMarkdown("<!-- recital syntax=console -->")).toThrow(/cmd=/);
  });

  it("throws on an unknown directive attribute", () => {
    expect(() => parseMarkdown("<!-- recital cmd=bash bogus=1 -->")).toThrow(/unknown attribute/);
  });

  it("throws when a block matches more than one directive", () => {
    expect(() =>
      parseMarkdown(
        [
          "<!-- recital cmd=bash -->",
          "<!-- recital syntax=console cmd=bash -->",
          "```console",
          "$ true",
          "```",
        ].join("\n"),
      ),
    ).toThrow(/multiple recital directives/);
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
      ['<!-- "/tmp/x" -->', "```console", "$ pwd", "/tmp/x", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["{{__recital_anon_0}}"]);
  });

  it("supports typed named and typed anonymous identity declarations", () => {
    const named = parseMarkdown(
      ['<!-- id:uuid "the-id" -->', "```console", "$ echo x", "the-id", "```"].join("\n"),
    );
    expect(named.blocks[0]!.interactions[0]!.expected).toEqual(["{{id:uuid}}"]);

    const anon = parseMarkdown(
      ['<!-- :path "/tmp/x" -->', "```console", "$ pwd", "/tmp/x", "```"].join("\n"),
    );
    expect(anon.blocks[0]!.interactions[0]!.expected).toEqual(["{{__recital_anon_0:path}}"]);
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
