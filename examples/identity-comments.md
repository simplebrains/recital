# Keeping the session literal

<!-- recital syntax=console cmd=bash -->

Sometimes `{{name}}` markup inside a block spoils the illusion of a real
terminal session. Instead, declare a value to be *an identity to itself* in an
HTML comment *outside* the fence — invisible when the Markdown is rendered — by
writing the real-looking value in quotes.

The comment below says: wherever the literal path
`/var/folders/xx/example/T/tmp.EXAMPLE` shows up in the following session, every
occurrence is the same value — capture it once, then require it to recur.

<!-- "/var/folders/xx/example/T/tmp.EXAMPLE" -->

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

If it helps the prose to name the value, put a name before the quotes; add a
`:type` to constrain what it may capture (here, an integer). The value is
captured the first time it appears in *output*, then reused everywhere after —
including inside later commands:

<!-- answer:int "42" -->

```console
$ echo $((6 * 7))
42
$ echo "the answer is 42"
the answer is 42
```
