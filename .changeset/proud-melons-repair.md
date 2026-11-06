---
"graphile-worker": patch
---

Fix unhandled rejection when recording a job's outcome fails with the default
unbatched `completeJob`/`failJob` (`completeJobBatchDelay`/`failJobBatchDelay`
of `-1`). Failures are now handled like the batched path: emitted as
`pool:fatalError`, logged with the job id, and the worker pool shuts down
gracefully with the error propagated to `workerPool.promise`.
