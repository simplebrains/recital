# Bind comment shapes

`bind` accepts a string, a sequence, or a name mapping. A `bind` field on a
**session** directive is the same mechanism, applied from that point in the
document. Standalone bind comments are positional — they apply only to the
blocks that follow them.

<!-- recital:
cmd: bash
syntax: console
bind: "/var/folders/xx/example/T/tmp.SESSION"
-->

Declared on the session: wherever this path appears, it is one identity.

```console
$ cd "$(mktemp -d)"
$ pwd
/var/folders/xx/example/T/tmp.SESSION
$ echo "still in /var/folders/xx/example/T/tmp.SESSION"
still in /var/folders/xx/example/T/tmp.SESSION
```

A later comment can add more identities. A sequence may mix a named string
and a typed anonymous `{ type, text }` entry (named typed mappings are in
`identity-comments.md`).

<!-- recital type: { int: "-?\\d+" } -->
<!-- recital bind:
- n: "7"
- { type: int, text: "99" }
-->

```console
$ echo $((3 + 4))
7
$ echo "n is 7"
n is 7
$ echo $((90 + 9))
99
$ echo "also 99"
also 99
```
