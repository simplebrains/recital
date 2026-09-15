# Hello, recital

This document opts in to being run with a directive comment: recital drives a
`bash` session and interprets every fenced `console` block.

<!-- recital: { cmd: bash, syntax: console } -->

The simplest possible session: a command and its exact output.

```console
$ echo hello
hello
```

Multiple commands run in order, sharing one shell:

```console
$ echo one
one
$ echo two
two
```
