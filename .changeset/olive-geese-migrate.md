---
"graphile-worker": patch
---

`makeWorkerUtils()` no longer runs database migrations automatically (fixes
#566). If you need the database schema installed or updated, call
`await utils.migrate()` explicitly. `run()`, `runOnce()`, `runMigrations()` and
the CLI still migrate explicitly before doing anything else.
