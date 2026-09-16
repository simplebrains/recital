# A stateful session

<!-- recital: { cmd: bash, syntax: console } -->
<!-- recital type: { path: "[^\\s]+" } -->

The session keeps its working directory between commands, and can capture
nondeterministic values into named bindings that later steps reuse.

Move into a fresh temp directory and confirm where we are:

```console
$ cd "$(mktemp -d)"
$ pwd
{{workdir:path}}
```

Because the shell persists, the next command is still in that directory — and
the captured `workdir` must recur exactly:

```console
$ echo "working in {{workdir}}"
working in {{workdir}}
$ touch a.txt b.txt
$ ls
a.txt
b.txt
```

Typed wildcards match nondeterministic output without binding it. Here the file
size and timestamp vary, so we skip them and only pin the name:

```console
$ ls -l a.txt
{{*}} a.txt
```
