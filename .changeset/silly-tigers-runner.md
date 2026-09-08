---
"graphile-worker": minor
---

`Runner` gains `[Symbol.asyncDispose]()` method, so you can
`await using runner = await run(...)` and the worker will be released when you
reach the end of the scope. (Primarily useful for tests.)
