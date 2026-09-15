# Selecting by syntax

`two-sessions.md` splits sessions by fence **pragma**. They can also be split
by **syntax** — the fence language — so a `console` block and a `sh` block
are different persistent shells.

<!-- recital: { cmd: bash, syntax: console } -->
<!-- recital: { cmd: bash, syntax: sh } -->

```console
$ X=1
$ echo "$X"
1
```

```sh
$ X=99
$ echo "$X"
99
```

The `console` session was not overwritten by the `sh` block in between:

```console
$ echo "$X"
1
```
