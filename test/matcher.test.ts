import { describe, expect, it } from "vitest";

import {
  matchBlock,
  matchLine,
  normalizeOutput,
  stripAnsi,
  substituteBindings,
} from "../src/matcher.js";

describe("matchLine", () => {
  it("matches literal text exactly", () => {
    expect(matchLine("hello world", "hello world", {}).ok).toBe(true);
    expect(matchLine("hello world", "hello there", {}).ok).toBe(false);
  });

  it("treats regex metacharacters in the template as literals", () => {
    expect(matchLine("a.b(c)+", "a.b(c)+", {}).ok).toBe(true);
    expect(matchLine("a.b(c)+", "axbXcXX", {}).ok).toBe(false);
  });

  it("captures typed values into bindings", () => {
    const r = matchLine("id: {{x:int}}", "id: 42", {});
    expect(r.ok).toBe(true);
    expect(r.captures).toEqual({ x: "42" });
  });

  it("rejects values that do not fit the type", () => {
    expect(matchLine("id: {{x:int}}", "id: abc", {}).ok).toBe(false);
  });

  it("treats an already-bound name as a back-reference", () => {
    expect(matchLine("again: {{x}}", "again: 42", { x: "42" }).ok).toBe(true);
    expect(matchLine("again: {{x}}", "again: 99", { x: "42" }).ok).toBe(false);
  });

  it("enforces internal consistency for a name repeated on one line", () => {
    expect(matchLine("{{a}} == {{a}}", "5 == 5", {}).ok).toBe(true);
    expect(matchLine("{{a}} == {{a}}", "5 == 6", {}).ok).toBe(false);
  });

  it("supports anonymous wildcards that bind nothing", () => {
    const r = matchLine("size {{*}} name", "size 1234 name", {});
    expect(r.ok).toBe(true);
    expect(r.captures).toEqual({});
  });

  it("matches uuids", () => {
    const uuid = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    const r = matchLine("id={{u:uuid}}", `id=${uuid}`, {});
    expect(r.ok).toBe(true);
    expect(r.captures.u).toBe(uuid);
  });
});

describe("matchBlock", () => {
  it("requires the same number of lines by default", () => {
    expect(matchBlock(["a", "b"], ["a", "b"], {}).ok).toBe(true);
    expect(matchBlock(["a", "b"], ["a"], {}).ok).toBe(false);
    expect(matchBlock(["a"], ["a", "b"], {}).ok).toBe(false);
  });

  it("threads captures across lines", () => {
    const r = matchBlock(["id {{x:int}}", "same {{x}}"], ["id 7", "same 7"], {});
    expect(r.ok).toBe(true);
    expect(r.bindings.x).toBe("7");
  });

  it("fails when a back-reference across lines does not recur", () => {
    expect(matchBlock(["id {{x:int}}", "same {{x}}"], ["id 7", "same 8"], {}).ok).toBe(
      false,
    );
  });

  it("supports a `...` line that skips arbitrary output", () => {
    expect(matchBlock(["start", "...", "end"], ["start", "x", "y", "end"], {}).ok).toBe(
      true,
    );
    expect(matchBlock(["start", "...", "end"], ["start", "end"], {}).ok).toBe(true);
    expect(matchBlock(["...", "end"], ["a", "b", "end"], {}).ok).toBe(true);
  });

  it("matches anything when there is no expectation", () => {
    expect(matchBlock([], ["whatever"], {}).ok).toBe(true);
  });
});

describe("normalizeOutput", () => {
  it("normalizes newlines and trims surrounding blank lines", () => {
    expect(normalizeOutput("\r\na\r\nb\n\n")).toEqual(["a", "b"]);
  });

  it("strips ANSI colour codes by default", () => {
    expect(normalizeOutput("\x1b[31mred\x1b[0m")).toEqual(["red"]);
  });
});

describe("stripAnsi", () => {
  it("removes escape sequences", () => {
    expect(stripAnsi("\x1b[1;32mok\x1b[0m")).toBe("ok");
  });
});

describe("substituteBindings", () => {
  it("substitutes bound references into commands", () => {
    expect(substituteBindings("show {{id}}", { id: "abc" })).toBe("show abc");
  });

  it("throws on unbound references", () => {
    expect(() => substituteBindings("show {{id}}", {})).toThrow(/unbound/);
  });

  it("leaves unbound typed-capture tokens untouched", () => {
    expect(substituteBindings("show {{id:uuid}}", {})).toBe("show {{id:uuid}}");
  });

  it("substitutes a bound typed token by name, ignoring the type", () => {
    expect(substituteBindings("show {{id:uuid}}", { id: "abc" })).toBe("show abc");
  });
});
