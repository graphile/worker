---
"graphile-worker": patch
---

`runner.promise` rejects again when the worker pool (or cron) exits with an
error, instead of resolving as if `runner.stop()` had been called. This also
makes the CLI exit non-zero after a worker pool failure.
