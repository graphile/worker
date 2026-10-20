---
"graphile-worker": patch
---

Fix `add_jobs` keyed scheduling race when a worker locks the row concurrently,
and preserve retry `attempts` on in-flight batch jobs when clearing their key.
