# recital

Write a Markdown file that *looks* like a terminal session, and run it — a
**recital** of that session. The same document is documentation a human can
read, and an executable test a machine can verify.

<!-- recital: { cmd: bash, syntax: console } -->
<!-- recital type:
path: "[^\\s]+"
uuid: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
-->

```console
$ echo hello
hello
```

That fenced `console` block is a real test: `recital` runs `echo hello` in a
shell and asserts the output is `hello` — because the comment above opted the
document in.

## Install

```bash
npm install --save-dev @simplebrains/recital
```

## Opting in with a directive

By default recital interprets **nothing**. A document opts in with one or more
YAML comments — invisible in rendered Markdown:

````markdown
<!-- recital: { cmd: bash, syntax: console } -->
````

Or the equivalent prefix sugar / multi-line form:

````markdown
<!-- recital cmd: bash -->

<!-- recital:
cmd: bash
syntax: console
-->
````

Shared boilerplate (a session directive, bind set, etc.) can live in another
file and be **included** in place — not as a session field, but as a
source-level rewrite before parsing:

````markdown
<!-- recital include: ./fragments/bash-console.md -->
````

Paths are relative to the file that contains the include; nested includes
resolve relative to themselves. Circular includes are an error. Do not combine
`include` with other fields in the same comment.

A directive both configures a **session** and selects which fenced code blocks
belong to it:

| Field       | Meaning                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `cmd`       | **Required.** Command used to drive the session (e.g. `bash`).          |
| `prompt`    | Drive `cmd` as an interactive REPL, syncing on this prompt string (see [Driving a REPL](#driving-a-repl)). |
| `syntax`    | Only match blocks fenced with this language.                            |
| `pragma`    | Only match blocks whose fence **pragma** contains this string.          |
| `isolate`   | Run each matching block in its own fresh session.                       |
| `cwd`       | `"temp"` (host-managed temp dir, removed on end) or a path string.      |
| `env`       | Map of environment variables injected into the session.                 |
| `setup`     | Shell snippet run once when the session starts.                         |
| `teardown`  | Shell snippet always run when the session ends.                         |
| `bind`      | Optional literal-identity set declared at this point (see below).       |
| `type`      | Optional named regex fragments for matcher tokens (see below).          |

Directives are **file-global**: every code block is matched against all of them.
A block that matches no directive is left alone; a block that matches *more than
one* is an error (make the selectors disjoint). Prefix sugar does **not** merge
across comments — `<!-- recital cmd: bash -->` and `<!-- recital syntax: console -->`
are two separate comments, and the second errors (session fields without `cmd`).

### Driving a REPL

By default recital drives a bash-like shell: it feeds each command over stdin
and delimits the output with an injected sentinel. That can't drive a program
that reads its **own** stdin — an interactive REPL (a language shell, a database
client, an app's own `> ` prompt). For those, give the directive a `prompt`:

````markdown
<!-- recital: { cmd: "python3 -i -q", prompt: ">>> ", syntax: console } -->

```console
$ 1 + 1
2
$ "ab" * 3
'ababab'
```
````

With `prompt` set, recital launches `cmd` as a REPL and treats the **prompt
reappearing** as the end-of-command signal — the one assumption that holds for
an arbitrary REPL. Commands are still written with the usual `$ ` marker; the
program's own prompt is what recital watches for, not something you type.

Details and constraints:

- `cmd` is launched via `bash -c '<setup>; exec <cmd> 2>&1'`, so a `setup`
  snippet still runs (in bash) and its `cd`/exports carry into the REPL, and the
  REPL's stderr (where many REPLs print the prompt) is folded into stdout in
  order. `teardown` is not run in prompt mode (the REPL replaces the shell); use
  `cwd: temp` for cleanup.
- The program must print `prompt` when it is ready for input — including once at
  startup. REPLs that only prompt on a TTY may need a flag to force it
  (`python3 -i`, `node -i`, `bash --norc -i` with a set `PS1`, …).
- Output is matched exactly as in any session; a leading echoed copy of the
  command (some shells echo the line they read on a pipe) is stripped.

### More than one session

A document can describe several sessions at once — select them apart by
`syntax` or `pragma`. Blocks are dispatched to their own session but always
**executed in document order**, even when the sessions are interleaved:

````markdown
<!-- recital: { cmd: bash, syntax: console, pragma: "session A" } -->
<!-- recital: { cmd: bash, syntax: console, pragma: "session B" } -->

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

### Environment setup for CI

Use `cwd: temp` plus optional `setup` / `teardown` when a session needs an
isolated working directory:

````markdown
<!-- recital:
cmd: bash
syntax: console
cwd: temp
setup: |
  npm ci --ignore-scripts
-->
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

Aside from the reserved built-in `any` (`.+?`), types are **user-defined**
regex fragments declared with `type:`:

````markdown
<!-- recital type:
uuid: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
path: "[^\\s]+"
-->
````

Patterns are fragments spliced into a line regex. A leading `^` and trailing
`$` are stripped, so `^[0-9a-f]+$` and `[0-9a-f]+` are equivalent. Types
accumulate positionally from the comment forward (including via includes).

```console
$ echo "created 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
created {{id:uuid}}
$ echo "fetching {{id}}"
fetching {{id}}
```

Output is normalized before matching (newlines canonicalized, ANSI colour
stripped, trailing whitespace and surrounding blank lines trimmed). Captured
bindings are per session.

### Keeping the transcript literal

`{{name}}` markup inside a block can spoil the illusion of a real terminal
session. To keep the fenced block **fully literal**, declare a value to be *an
identity to itself* with a `bind` comment — using a real-looking value:

````markdown
<!-- recital bind: "/var/folders/xx/T/tmp.abc123" -->

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
but the transcript still reads like an ordinary session.

`bind` accepts a string, a sequence, or a name mapping. Unlike session
directives, bind comments are **positional** — they apply to the blocks that
follow them:

````markdown
<!-- recital bind: "/tmp/a" -->

<!-- recital type: { uuid: "[0-9a-fA-F-]+", int: "-?\\d+" } -->
<!-- recital bind:
- "/tmp/a"
- workdir: "/tmp/b"
- { type: uuid, text: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }
-->

<!-- recital bind:
answer:
  type: int
  text: "42"
-->
````

When many distinct values share one shape, bind **by type alone** — every
distinct substring matching that type becomes its own anonymous identity:

````markdown
<!-- recital type: { doc_id: "d_[a-z0-9]{7}" } -->
<!-- recital bind: { type: doc_id } -->
````

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
  "<!-- recital cmd: bash -->\n```console\n$ echo hi\nhi\n```",
);
result.ok; // true
```

- `parseMarkdown(source, opts)` → expands includes, then returns directives +
  structured blocks/interactions.
- `expandIncludes(source, opts)` → source-level include rewrite only.
- `runDocument(source, opts)` / `runParsedDocument(parsed, opts)` → run end-to-end.
- `DirectiveSession` → open/close a directive's shell with setup/teardown/cwd.
- `Runner` → drive blocks one at a time over a single shared session.
- `matchBlock`, `matchLine`, `normalizeOutput`, `substituteBindings` → the
  matcher internals.

## Notes & limitations

- The default (bash-sentinel) runner drives a shell by feeding commands over
  stdin and delimiting output with a random sentinel. Commands that **read from
  stdin** interactively (e.g. a bare `cat`) will consume that framing and are not
  supported — pipe input in instead, or drive the program as a REPL with
  [`prompt`](#driving-a-repl).
- stderr is merged into stdout in program order (`exec 2>&1`).

## Licence

MIT
