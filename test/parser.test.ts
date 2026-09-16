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
      ["<!-- recital cmd: bash -->", "```console", "$ echo hi", "hi", "```"].join("\n"),
    );
    expect(doc.directives[0]).toMatchObject({ cmd: "bash", isolate: false });
    expect(doc.blocks[0]!.directive).toBe(doc.directives[0]);
  });

  it("a mapping directive can set syntax and other session fields", () => {
    const doc = parseMarkdown(
      [
        "<!-- recital:",
        "cmd: bash",
        "syntax: console",
        "isolate: true",
        "cwd: temp",
        "env:",
        "  FOO: bar",
        "setup: |",
        "  true",
        "teardown: |",
        "  true",
        "-->",
        "```console",
        "$ echo hi",
        "hi",
        "```",
        "```js",
        "not run",
        "```",
      ].join("\n"),
    );
    expect(doc.directives[0]).toMatchObject({
      cmd: "bash",
      syntax: "console",
      isolate: true,
      cwd: "temp",
      env: { FOO: "bar" },
      setup: "true\n",
      teardown: "true\n",
    });
    expect(doc.blocks[0]!.directive).toBe(doc.directives[0]);
    expect(doc.blocks[1]!.directive).toBeUndefined();
  });

  it("a pragma directive owns only blocks whose pragma contains the text", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital: { cmd: bash, pragma: "Bob logs in" } -->',
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

  it("assigns interleaved blocks to their own directive", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital: { cmd: bash, syntax: console, pragma: "A" } -->',
        '<!-- recital: { cmd: bash, syntax: console, pragma: "B" } -->',
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

  it("throws when a session key is used without cmd", () => {
    expect(() => parseMarkdown("<!-- recital syntax: console -->")).toThrow(/no cmd/);
  });

  it("throws on an unknown field", () => {
    expect(() => parseMarkdown("<!-- recital: { cmd: bash, bogus: 1 } -->")).toThrow(
      /unknown field/,
    );
  });

  it("throws when a block matches more than one directive", () => {
    expect(() =>
      parseMarkdown(
        [
          "<!-- recital cmd: bash -->",
          "<!-- recital: { cmd: bash, syntax: console } -->",
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

  it("normalizes prompt and continue from a string or a list", () => {
    const single = parseMarkdown(
      '<!-- recital: { cmd: bash, prompt: ">>> ", continue: "... " } -->',
    );
    expect(single.directives[0]).toMatchObject({
      prompt: [">>> "],
      continue: ["... "],
    });

    const many = parseMarkdown(
      [
        "<!-- recital:",
        "cmd: bash",
        'prompt: ["a> ", "b> "]',
        'continue: ["... ", ".. "]',
        "-->",
      ].join("\n"),
    );
    expect(many.directives[0]).toMatchObject({
      prompt: ["a> ", "b> "],
      continue: ["... ", ".. "],
    });

    const defaults = parseMarkdown("<!-- recital cmd: bash -->");
    expect(defaults.directives[0]!.continue).toEqual(["> ", ">"]);
    expect(defaults.directives[0]!.prompt).toBeUndefined();
  });

  it("rejects empty prompt or continue values", () => {
    expect(() => parseMarkdown('<!-- recital: { cmd: bash, prompt: "" } -->')).toThrow(
      /prompt/,
    );
    expect(() => parseMarkdown("<!-- recital: { cmd: bash, prompt: [] } -->")).toThrow(
      /prompt/,
    );
    expect(() => parseMarkdown('<!-- recital: { cmd: bash, continue: "" } -->')).toThrow(
      /continue/,
    );
  });

  it("uses configured continue markers (e.g. Python secondary prompt)", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital: { cmd: bash, prompt: ">>> ", continue: ["... ", "..."] } -->',
        "```console",
        ">>> def f():",
        "...   return 1",
        "...",
        ">>> f()",
        "1",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.interactions.map((i) => i.command)).toEqual([
      "def f():\n  return 1\n",
      "f()",
    ]);
    expect(doc.blocks[0]!.interactions[1]!.expected).toEqual(["1"]);
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

  it("rewrites a named bind into binding tokens", () => {
    const doc = parseMarkdown(
      [
        "<!-- recital bind:",
        'workdir: "/tmp/x"',
        "-->",
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

  it("rewrites an anonymous bind into a synthetic binding token", () => {
    const doc = parseMarkdown(
      ['<!-- recital bind: "/tmp/x" -->', "```console", "$ pwd", "/tmp/x", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["{{__recital_anon_0}}"]);
  });

  it("supports typed named and typed anonymous bind entries", () => {
    const named = parseMarkdown(
      [
        "<!-- recital type: { uuid: \"[0-9a-f-]+\" } -->",
        "<!-- recital bind:",
        'id: { type: uuid, text: "the-id" }',
        "-->",
        "```console",
        "$ echo x",
        "the-id",
        "```",
      ].join("\n"),
    );
    expect(named.blocks[0]!.interactions[0]!.expected).toEqual(["{{id:uuid}}"]);
    expect(named.blocks[0]!.types).toEqual({ uuid: "[0-9a-f-]+" });

    const anon = parseMarkdown(
      [
        '<!-- recital type: { path: "[^\\\\s]+" } -->',
        "<!-- recital bind:",
        '- { type: path, text: "/tmp/x" }',
        "-->",
        "```console",
        "$ pwd",
        "/tmp/x",
        "```",
      ].join("\n"),
    );
    expect(anon.blocks[0]!.interactions[0]!.expected).toEqual(["{{__recital_anon_0:path}}"]);
  });

  it("registers types and strips ^/$ anchors", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital type: { hex: "^[0-9a-f]+$" } -->',
        "```console",
        "$ true",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.types).toEqual({ hex: "[0-9a-f]+" });
  });

  it("rejects redefining any or an existing type", () => {
    expect(() => parseMarkdown('<!-- recital type: { any: "x" } -->')).toThrow(/reserved/);
    expect(() =>
      parseMarkdown(
        ['<!-- recital type: { hex: "a" } -->', '<!-- recital type: { hex: "b" } -->'].join(
          "\n",
        ),
      ),
    ).toThrow(/redefines/);
  });

  it("expands type-only bind into per-match anonymous identities", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital type: { doc_id: "d_[a-z0-9]{7}" } -->',
        "<!-- recital bind: { type: doc_id } -->",
        "```console",
        "$ true",
        "d_9f4k2qa",
        "d_3xb7m0c",
        "d_9f4k2qa",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual([
      "{{__recital_anon_1:doc_id}}",
      "{{__recital_anon_2:doc_id}}",
      "{{__recital_anon_1:doc_id}}",
    ]);
  });

  it("lets an explicit text bind claim a value before type-only expansion", () => {
    const doc = parseMarkdown(
      [
        '<!-- recital type: { doc_id: "d_[a-z0-9]{7}" } -->',
        "<!-- recital bind:",
        '- main: { type: doc_id, text: "d_9f4k2qa" }',
        "- { type: doc_id }",
        "-->",
        "```console",
        "$ true",
        "d_9f4k2qa",
        "d_3xb7m0c",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual([
      "{{main:doc_id}}",
      "{{__recital_anon_1:doc_id}}",
    ]);
  });

  it("rejects type-only bind with any", () => {
    expect(() => parseMarkdown("<!-- recital bind: { type: any } -->")).toThrow(
      /type-only bind with reserved type "any"/,
    );
  });

  it("only applies types declared before a block", () => {
    const doc = parseMarkdown(
      [
        "```console",
        "$ true",
        "```",
        '<!-- recital type: { hex: "[0-9a-f]+" } -->',
        "```console",
        "$ true",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.types).toEqual({});
    expect(doc.blocks[1]!.types).toEqual({ hex: "[0-9a-f]+" });
  });

  it("applies bind entries declared on a session directive", () => {
    const doc = parseMarkdown(
      [
        "<!-- recital:",
        "cmd: bash",
        "bind:",
        '  - "/tmp/x"',
        "-->",
        "```console",
        "$ pwd",
        "/tmp/x",
        "```",
      ].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["{{__recital_anon_0}}"]);
  });

  it("ignores ordinary HTML comments", () => {
    const doc = parseMarkdown(
      ["<!-- just a note -->", "```console", "$ echo hi", "hi", "```"].join("\n"),
    );
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["hi"]);
  });

  it("only applies a bind declaration to blocks that follow it", () => {
    const doc = parseMarkdown(
      [
        "```console",
        "$ echo /tmp/x",
        "/tmp/x",
        "```",
        '<!-- recital bind: workdir: "/tmp/x" -->',
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
