# Two interleaved sessions

A single document can describe more than one session. Here two directives
select blocks by their fence **pragma** — the text after the language token.
Each directive owns one persistent `bash` session.

<!-- recital: { cmd: bash, syntax: console, pragma: "session A" } -->
<!-- recital: { cmd: bash, syntax: console, pragma: "session B" } -->

Session A sets a variable:

```console session A
$ X=1
$ echo "$X"
1
```

Session B is a different shell, so it starts fresh and sets its own:

```console session B
$ X=99
$ echo "$X"
99
```

Even though session B ran in between, session A still has its own state — blocks
are dispatched to their own session but executed in document order:

```console session A
$ echo "$X"
1
```
