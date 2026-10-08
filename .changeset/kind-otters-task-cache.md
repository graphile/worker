---
"graphile-worker": patch
---

Clear the task identifier cache when a lookup fails, so a later poll retries
instead of reusing the rejected promise (#638).
