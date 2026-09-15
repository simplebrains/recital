# Session lifecycle

A directive can start in a throwaway directory, inject environment variables,
run a **setup** snippet before any command, and always run **teardown** when
the session ends.

<!-- recital:
cmd: bash
syntax: console
pragma: "prepared"
cwd: temp
env:
  RECITAL_GREETING: howdy
setup: |
  printf '%s\n' 'from setup' > prepared.txt
teardown: |
  rm -f prepared.txt
-->

`cwd: temp` is a host-managed directory: created for this session, removed when
it ends. `setup` has already run, so the file is waiting, and `env` is visible
to every command:

```console prepared
$ echo "$RECITAL_GREETING"
howdy
$ cat prepared.txt
from setup
$ ls
prepared.txt
```

`teardown` is not a command in the transcript — it runs when the session
closes, including after a failed assertion. Its output is not matched here.

## Isolated blocks re-run setup

With `isolate: true`, each block is a fresh session: `setup` runs again, and
nothing set inside the previous block carries over.

<!-- recital:
cmd: bash
syntax: console
pragma: "fresh"
isolate: true
setup: |
  export MARK=from-setup
-->

```console fresh
$ echo "$MARK"
from-setup
$ X=1
$ echo "$X"
1
```

```console fresh
$ echo "$MARK"
from-setup
$ echo "${X:-unset}"
unset
```
