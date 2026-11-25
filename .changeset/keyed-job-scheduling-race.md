---
"graphile-worker": patch
---

Fix a keyed job scheduling race that could return no job row when concurrent
calls overlap with a locked job.
