---
"graphile-worker": patch
---

Fix batched `completeJobs`/`failJobs` never being retried. The retry loop in
`batch()` bailed out of its `catch` with `break`, so `BATCH_RETRY_OPTIONS` was
dead code: a single transient database error (e.g. a `40P01` deadlock,
serialization failure or dropped connection) tore the worker pool down instead
of retrying, leaving the batched jobs locked so they were later re-executed
(duplicate execution). The failed attempt now falls through to the next
iteration and is retried with backoff, only throwing once `maxAttempts` is
exhausted. Also clear the `backpressure` deferred once resolved so the pending
refcount stays balanced across repeated hold/release cycles.
