---
"graphile-worker": minor
---

TypeScript task files with `.ts` and `.mts` extensions are now recognized by
default and loaded through Node's native type stripping if possible. Only
erasable, verbatim TypeScript syntax is supported without a custom loader or
precompilation. `.js`, `.cjs` and `.mjs` files are prioritised ahead of `.ts`
and `.mts` files.
