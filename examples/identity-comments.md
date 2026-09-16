# Keeping the session literal

<!-- recital: { cmd: bash, syntax: console } -->

Sometimes `{{name}}` markup inside a block spoils the illusion of a real
terminal session. Instead, declare a value to be *an identity to itself* with a
`bind` comment — invisible when the Markdown is rendered — by writing the
real-looking value as YAML:

The comment below says: wherever the literal path
`/var/folders/xx/example/T/tmp.EXAMPLE` shows up in the following session, every
occurrence is the same value — capture it once, then require it to recur.

<!-- recital bind: "/var/folders/xx/example/T/tmp.EXAMPLE" -->

```console
$ cd "$(mktemp -d)"
$ pwd
/var/folders/xx/example/T/tmp.EXAMPLE
$ echo "still working in /var/folders/xx/example/T/tmp.EXAMPLE"
still working in /var/folders/xx/example/T/tmp.EXAMPLE
```

At runtime the real temp directory is captured from `pwd`, the literal in the
`echo` command is substituted with it, and the literal in that command's output
must match the captured value — exactly as if we had written `{{workdir}}`, but
the transcript still reads like an ordinary session, and we never had to name
anything.

## Naming or typing an identity

If it helps the prose to name the value, use a mapping entry; nest `type` and
`text` to constrain what it may capture. Declare the type first (here, an
integer). The value is captured the first time it appears in *output*, then
reused everywhere after — including inside later commands:

<!-- recital type: { int: "-?\\d+" } -->
<!-- recital bind:
answer:
  type: int
  text: "42"
-->

```console
$ echo $((6 * 7))
42
$ echo "the answer is 42"
the answer is 42
```
