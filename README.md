# recital

Write a Markdown file that *looks* like a terminal session, and run it — a
**recital** of that session. The same document is documentation a human can
read, and an executable test a machine can verify.

```console
$ echo hello
hello
```

That fenced `console` block is a real test: `recital` runs `echo hello` in a
shell and asserts the output is `hello`.

## Install

```bash
npm install --save-dev recital
```

## The format

A runnable block is a fenced code block tagged **`console`**. Inside it:

- a line beginning with `$ ` is a **command** sent to the shell;
- a line beginning with `> ` continues the previous command;
- every other line, up to the next command, is that command's **expected
  output**.

Commands in a document share **one persistent shell**, so `cd`, exported
variables, and shell functions carry across steps exactly like a real session:

```console
$ cd "$(mktemp -d)"
$ pwd
{{workdir:path}}
$ touch note.txt && ls
note.txt
```

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
lines trimmed).

### Keeping the transcript literal

`{{name}}` markup inside a block can spoil the illusion of a real terminal
session. To keep the fenced block **fully literal**, declare a value to be *an
identity to itself* in an HTML comment *outside* the fence — invisible in
rendered Markdown — using a real-looking value in quotes:

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

Add a name and/or a type if it helps the prose:

| Declaration                        | Meaning                                  |
| ---------------------------------- | ---------------------------------------- |
| `<!-- "…" -->`                     | Anonymous identity.                      |
| `<!-- workdir "…" -->`             | Named identity.                          |
| `<!-- workdir:path "…" -->`        | Named identity, capture constrained.     |
| `<!-- :path "…" -->`               | Anonymous identity, capture constrained. |

A declaration applies to every block that follows it in the document.

### Block options

Options go on the fence info string:

````markdown
```console cwd="packages/app" exit=1 skip
```
````

- `cwd=<dir>` — run the block's commands from this directory.
- `exit=<n>` — assert every command in the block exits with code `n`.
- `skip` — parse but don't run the block.

## Running from the CLI

```bash
# Run every .md under a directory (or pass files / globs)
npx recital run docs/
npx recital run README.md examples/*.md

# Require commands to succeed unless a block sets exit=
npx recital run docs/ --expect-success
```

`recital` exits non-zero if any document fails. Run `recital --help` for all
options (`--shell`, `--cwd`, `--lang`, …).

## Running inside vitest

```ts
// docs.test.ts
import { describeMarkdown } from "recital/vitest";

describeMarkdown("docs/**/*.md");
```

Each file becomes a `describe`, each block a `test`, and the blocks of a file
share one shell session (so state carries across them). Pass runner options as a
second argument, e.g. `describeMarkdown("docs/", { expectSuccess: true })`.

## Programmatic API

```ts
import { runDocument, parseMarkdown, Runner } from "recital";

const result = await runDocument("```console\n$ echo hi\nhi\n```", {
  expectSuccess: true,
});
result.ok; // true
```

- `parseMarkdown(source, opts)` → structured blocks/interactions.
- `runDocument(source, opts)` / `runParsedDocument(parsed, opts)` → run end-to-end.
- `Runner` → drive blocks one at a time over a shared session.
- `matchBlock`, `matchLine`, `normalizeOutput`, `substituteBindings` → the
  matcher internals.

## Notes & limitations

- The runner drives a shell (`bash` by default) by feeding commands over stdin
  and delimiting output with a random sentinel. Commands that **read from
  stdin** interactively (e.g. a bare `cat`) will consume that framing and are
  not supported — pipe input in instead.
- stderr is merged into stdout in program order (`exec 2>&1`).

## Licence

MIT
