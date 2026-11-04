---
"graphile-worker": patch
---

Fix a bug (introduced 0.17.0) where jobs in named queues may drain as slowly as
once per `pollInterval`.
