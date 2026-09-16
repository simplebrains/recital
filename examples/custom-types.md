# User-defined types and type-only bind

Aside from the reserved built-in `any`, matcher types are named regex
fragments you declare yourself. Leading `^` / trailing `$` are stripped so
full-string-looking patterns still work as capture fragments.

<!-- recital: { cmd: bash, syntax: console } -->
<!-- recital type:
hex: "^[0-9a-f]+$"
doc_id: "d_[a-z0-9]{7}"
-->

A typed capture validates against the declared pattern:

```console
$ printf '%s\n' c1c4d4
{{digest:hex}}
$ echo "digest was {{digest}}"
digest was {{digest}}
```

## Bind by type alone

When many distinct values share one shape, listing every literal is noisy.
`bind: { type: doc_id }` means: in each following block, every distinct
substring matching `doc_id` is its own anonymous identity — same string shares
a binding; different strings get different ones.

The producing command builds the ids from parts so the full match is not
rewritten before it has been captured from output:

<!-- recital bind: { type: doc_id } -->

```console
$ printf 'd_%s\n' 9f4k2qa 3xb7m0c 9f4k2qa
d_9f4k2qa
d_3xb7m0c
d_9f4k2qa
$ echo "first was d_9f4k2qa; second was d_3xb7m0c"
first was d_9f4k2qa; second was d_3xb7m0c
```
