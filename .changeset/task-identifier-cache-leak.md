---
"graphile-worker": patch
---

Use a `WeakMap` for the task identifier cache so each run's compiled options can
be garbage collected. Long-lived processes that repeatedly start and stop
runners no longer retain one cache entry per run.
