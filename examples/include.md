# Includes

Long setup directives get ugly when copied across examples. An **include**
comment transcludes another Markdown file in place — typically a shared
session directive — before the document is parsed.

Nested includes resolve relative to the file that contains them. Include is
not a session setting: it stands alone and is expanded first.

<!-- recital include: ./fragments/bash-console.md -->

```console shared-setup
$ echo included
included
```
