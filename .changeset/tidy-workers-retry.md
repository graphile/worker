---
"graphile-worker": patch
---

Allow task identifier lookups to recover after a database error instead of
caching the rejected promise indefinitely. Pending lookups for an older task
list can no longer overwrite a newer cached result.
