# Matching output

Commands, continuations, and a few matcher tokens that `session.md` does not
cover. A line beginning with a continuation marker (default `> ` / `>`)
continues the previous command — the secondary-prompt convention. Override with
`continue:` when a REPL uses a different secondary prompt. A command with no
following output lines is still run; its output is ignored.

<!-- recital: { cmd: bash, syntax: console } -->

```console
$ true
$ printf '%s\n' \
> alpha \
> beta
alpha
beta
```

A whole-line `...` is a **line ellipsis**: it matches zero or more arbitrary
output lines. Named types are declared with `recital type:`; `{{:type}}` is an
anonymous typed wildcard — it matches, but binds nothing. `{{name:type}}`
still captures, so a later `{{name}}` must recur.

<!-- recital type:
int: "-?\\d+"
uuid: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
-->

```console
$ printf '%s\n' start ignored noise end
start
...
end
$ echo 42
{{:int}}
$ echo 3f2504e0-4f89-41d3-9a0c-0305e82c3301
{{id:uuid}}
$ echo "again 3f2504e0-4f89-41d3-9a0c-0305e82c3301"
again {{id}}
```
