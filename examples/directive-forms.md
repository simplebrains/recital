# Directive comment forms

A document opts in with YAML inside an HTML comment. Recital accepts three
spellings; they all parse to the same mapping. Prefix sugar does **not** merge
across comments — `<!-- recital cmd: bash -->` and
`<!-- recital syntax: console -->` are two separate comments, and the second
errors (session fields without `cmd`).

The prefix form is exercised in `prefix-sugar.md` (a cmd-only directive owns
every fence, so it needs its own file). This file runs the other two spellings
as disjoint sessions.

## Inline mapping

<!-- recital: { cmd: bash, syntax: console, pragma: "inline" } -->

```console inline
$ echo inline
inline
```

## Multi-line mapping

<!-- recital:
cmd: bash
syntax: console
pragma: "multiline"
-->

```console multiline
$ echo multiline
multiline
```
