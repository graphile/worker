---
"graphile-worker": patch
---

Fix a regression from 0.17.0 where a backlog in a named queue drained only once
per `pollInterval` after inserts stopped: idle workers are now woken as soon as
completing or failing a job releases its named queue.
