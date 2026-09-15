# Isolated blocks

Set `isolate: true` and every matching block runs in its own fresh session,
sharing nothing with the others.

<!-- recital: { cmd: bash, syntax: console, isolate: true } -->

The first block sets a variable:

```console
$ X=1
$ echo "$X"
1
```

The second block is a brand-new shell, so that variable is gone:

```console
$ echo "${X:-unset}"
unset
```
