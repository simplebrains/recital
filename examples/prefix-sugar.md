# Prefix sugar

The shortest opt-in is a single prefixed key. `<!-- recital cmd: bash -->`
desugars to `{ cmd: bash }` and, with no `syntax` or `pragma`, owns every
fenced block in the file.

<!-- recital cmd: bash -->

```console
$ echo hello
hello
```
