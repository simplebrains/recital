# recital

Write a Markdown file that *looks* like a terminal session, and run it — a
**recital** of that session. The same document is documentation a human can
read, and an executable test a machine can verify.

<!-- recital syntax=console cmd=bash -->

```console
$ echo hello
hello
```

That fenced `console` block is a real test: `recital` runs `echo hello` in a
shell and asserts the output is `hello` — because the comment above opted the
document in.

## Install

```bash
npm install --save-dev recital
```

## Opting in with a directive

By default recital interprets **nothing**. A document opts in with one or more
directive comments — invisible in rendered Markdown:

````markdown
<!-- recital syntax=console cmd=bash -->
````

A directive both configures a **session** and selects which fenced code blocks
belong to it:

- `cmd=<shell>` — **required**; the command used to drive the session (e.g. `bash`).
- `syntax=<language>` — only match blocks fenced with this language.
- `pragma=<text>` — only match blocks whose fence **pragma** (the text after the
  language token) contains this string.
- `isolate` — run each matching block in its own fresh session. By default all
  blocks matching a directive share one persistent session.

Directives are **file-global**: every code block is matched against all of them.
A block that matches no directive is left alone; a block that matches *more than
one* is an error (make the selectors disjoint). `cmd=` is required.

### More than one session

A document can describe several sessions at once — select them apart by
`syntax=` or `pragma=`. Blocks are dispatched to their own session but always
**executed in document order**, even when the sessions are interleaved:

````markdown
<!-- recital syntax=console cmd=bash pragma="session A" -->
<!-- recital syntax=console cmd=bash pragma="session B" -->

```console session A
$ X=1
```

```console session B
$ X=99
```

```console session A
$ echo "$X"
1
```
````

## The format

Inside a runnable block:

- a line beginning with `$ ` is a **command** sent to the shell;
- a line beginning with `> ` continues the previous command;
- every other line, up to the next command, is that command's **expected
  output**.

Commands in a session share **one persistent shell**, so `cd`, exported
variables, and shell functions carry across steps exactly like a real session:

```console
$ cd "$(mktemp -d)"
$ pwd
{{workdir:path}}
$ touch note.txt && ls
note.txt
```

recital asserts **output**, not exit status.

### Matching nondeterministic output

Output is matched **exactly** by default. A small vocabulary of tokens covers
values that vary between runs:

| Token             | Meaning                                                            |
| ----------------- | ------------------------------------------------------------------ |
| `{{name:type}}`   | Typed **capture** — binds `name` to the observed value.            |
| `{{name}}`        | Capture (type `any`), or a **back-reference** if already bound.    |
| `{{:type}}`       | Anonymous typed **wildcard** — matches, binds nothing.             |
| `{{*}}`           | Anonymous wildcard — matches any non-empty run on the line.        |
| `...` (whole line)| **Line ellipsis** — matches zero or more arbitrary output lines.   |

A **capture** binds a value; every later `{{name}}` — in expected output *or in
a command* — must be that same value. This is stronger than a wildcard: a
wildcard says "anything here," a capture says "anything here, but consistent
everywhere it recurs."

```console
$ echo "created 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
created {{id:uuid}}
$ echo "fetching {{id}}"
fetching {{id}}
```

Built-in types: `any`, `word`, `id`, `uuid`, `int`, `number`, `hex`, `path`,
`port`, `timestamp`, `email`. Output is normalized before matching (newlines
canonicalized, ANSI colour stripped, trailing whitespace and surrounding blank
lines trimmed). Captured bindings are per session.

### Keeping the transcript literal

`{{name}}` markup inside a block can spoil the illusion of a real terminal
session. To keep the fenced block **fully literal**, declare a value to be *an
identity to itself* in an HTML comment *outside* the fence — using a
real-looking value in quotes:

````markdown
<!-- "/var/folders/xx/T/tmp.abc123" -->

```console
$ cd "$(mktemp -d)"
$ pwd
/var/folders/xx/T/tmp.abc123
$ echo "still in /var/folders/xx/T/tmp.abc123"
still in /var/folders/xx/T/tmp.abc123
```
````

The point is **identity**: wherever that literal string appears in the session,
every occurrence is the same value — captured on first sight, back-referenced
(and substituted into commands) everywhere after — exactly like `{{workdir}}`,
but the transcript still reads like an ordinary session and nothing needs a
name.

Add a name and/or a type if it helps the prose. Unlike directives, identity
declarations are **positional** — they apply to the blocks that follow them:

| Declaration                        | Meaning                                  |
| ---------------------------------- | ---------------------------------------- |
| `<!-- "…" -->`                     | Anonymous identity.                      |
| `<!-- workdir "…" -->`             | Named identity.                          |
| `<!-- workdir:path "…" -->`        | Named identity, capture constrained.     |
| `<!-- :path "…" -->`               | Anonymous identity, capture constrained. |

## Running from the CLI

```bash
# Run every .md under a directory (or pass files / globs)
npx recital run docs/
npx recital run README.md examples/*.md
```

`recital` exits non-zero if any document fails. Documents without a directive
are skipped. Run `recital --help` for options (`--cwd`).

## Running inside vitest

```ts
// docs.test.ts
import { describeMarkdown } from "recital/vitest";

describeMarkdown("docs/**/*.md");
```

Each file becomes a `describe` and each runnable block a `test`; blocks sharing
a session share it here too (so state carries across them). Pass runner options
as a second argument, e.g. `describeMarkdown("docs/", { cwd: "packages/app" })`.

## Programmatic API

```ts
import { runDocument, parseMarkdown, Runner } from "recital";

const result = await runDocument(
  "<!-- recital cmd=bash -->\n```console\n$ echo hi\nhi\n```",
);
result.ok; // true
```

- `parseMarkdown(source, opts)` → directives + structured blocks/interactions.
- `runDocument(source, opts)` / `runParsedDocument(parsed, opts)` → run end-to-end.
- `Runner` → drive blocks one at a time over a single shared session.
- `matchBlock`, `matchLine`, `normalizeOutput`, `substituteBindings` → the
  matcher internals.

## Notes & limitations

- The runner drives a shell (via `cmd=`) by feeding commands over stdin and
  delimiting output with a random sentinel. Commands that **read from stdin**
  interactively (e.g. a bare `cat`) will consume that framing and are not
  supported — pipe input in instead.
- stderr is merged into stdout in program order (`exec 2>&1`).

## Licence

MIT
