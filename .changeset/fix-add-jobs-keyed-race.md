---
"graphile-worker": patch
---

Fix `add_jobs` keyed scheduling race when a worker locks the row concurrently,
preserve retry `attempts` on in-flight batch jobs when clearing their key, avoid
orphaning unlocked permanently-failed keyed jobs on replace, and delete
superseded in-flight non-batch jobs when returning or resetting stale locks.
