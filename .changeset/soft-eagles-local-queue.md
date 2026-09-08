---
"graphile-worker": patch
---

Fix issue where enabling `localQueue` could cause jobs from the same named queue
to run concurrently (violating the serial execution guarantee for named queues):
a single batch fetch could lock multiple jobs belonging to one named queue.
Batch fetches now return at most one job per named queue (#621).
