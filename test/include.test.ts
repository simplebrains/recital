import { describe, expect, it } from "vitest";

import { expandIncludes } from "../src/include.js";
import { parseMarkdown } from "../src/parser.js";

describe("expandIncludes", () => {
  it("transcludes a referenced file in place of the include comment", () => {
    const files: Record<string, string> = {
      "/docs/setup.md": "<!-- recital cmd: bash -->\n",
    };
    const out = expandIncludes('before\n<!-- recital include: ./setup.md -->\nafter\n', {
      path: "/docs/main.md",
      readFile: (p) => {
        if (!(p in files)) throw new Error(`missing ${p}`);
        return files[p]!;
      },
    });
    expect(out).toBe("before\n<!-- recital cmd: bash -->\nafter\n");
  });

  it("resolves nested includes relative to the included file", () => {
    const files: Record<string, string> = {
      "/docs/a/outer.md": "<!-- recital include: ../b/inner.md -->\n",
      "/docs/b/inner.md": "<!-- recital cmd: bash -->\ninner\n",
    };
    const out = expandIncludes("<!-- recital include: ./a/outer.md -->\n", {
      path: "/docs/main.md",
      readFile: (p) => {
        if (!(p in files)) throw new Error(`missing ${p}`);
        return files[p]!;
      },
    });
    expect(out).toBe("<!-- recital cmd: bash -->\ninner\n");
  });

  it("rejects circular includes", () => {
    const files: Record<string, string> = {
      "/docs/a.md": "<!-- recital include: ./b.md -->\n",
      "/docs/b.md": "<!-- recital include: ./a.md -->\n",
    };
    expect(() =>
      expandIncludes("<!-- recital include: ./a.md -->\n", {
        path: "/docs/main.md",
        readFile: (p) => files[p]!,
      }),
    ).toThrow(/Circular recital include/);
  });

  it("rejects combining include with other fields", () => {
    expect(() =>
      expandIncludes('<!-- recital: { include: "./x.md", cmd: bash } -->\n', {
        path: "/docs/main.md",
        readFile: () => "",
      }),
    ).toThrow(/must stand alone/);
  });

  it("does not expand includes inside fenced code blocks", () => {
    const source = [
      "```markdown",
      "<!-- recital include: ./secret.md -->",
      "```",
      "",
    ].join("\n");
    const out = expandIncludes(source, {
      path: "/docs/main.md",
      readFile: () => {
        throw new Error("should not read");
      },
    });
    expect(out).toBe(source);
  });
});

describe("parseMarkdown includes", () => {
  it("parses directives and binds contributed by an include", () => {
    const files: Record<string, string> = {
      "/docs/setup.md": [
        "<!-- recital: { cmd: bash, syntax: console } -->",
        '<!-- recital bind: workdir: "/tmp/x" -->',
        "",
      ].join("\n"),
    };
    const doc = parseMarkdown(
      [
        "<!-- recital include: ./setup.md -->",
        "```console",
        "$ pwd",
        "/tmp/x",
        "```",
      ].join("\n"),
      {
        path: "/docs/main.md",
        readFile: (p) => {
          if (!(p in files)) throw new Error(`missing ${p}`);
          return files[p]!;
        },
      },
    );
    expect(doc.directives[0]).toMatchObject({ cmd: "bash", syntax: "console" });
    expect(doc.blocks[0]!.directive).toBe(doc.directives[0]);
    expect(doc.blocks[0]!.interactions[0]!.expected).toEqual(["{{workdir}}"]);
  });
});
