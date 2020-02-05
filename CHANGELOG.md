# Changelog

### v0.4.0

Performance improvements and ability to efficiently queue jobs from JS.

BREAKING CHANGES:

- TypeScript:
  - the ID of a job is a `string` (database `bigint`), we previously incorrectly stated it was a `number`.
  - `Helpers` was renamed to `JobHelpers`
  - `TaskOptions` was renamed to `TaskSpec`
- `queue_name` is now nullable (leave it null for maximum parallel performance)
- when a job is modified using a `job_key`, the `queue_name` attribute is now reset like the other attributes

WARNINGS:

- The database schema has changed; your code should not depend on the database schema, only on the public interfaces (`add_job`, `remove_job`, etc), so this shouldn't be an issue.

New features:

- Significantly enhanced performance
  - Changes database schema such that a job_queue record is only added/checked when necessary
  - Uses prepared statements
  - Can override the PostgreSQL pool size on the CLI (via `--max-pool-size`)
- Dedicated API for queueing jobs from JavaScript/TypeScript (`makeWorkerUtils` / `quickAddJob`; @mrmurphy, @benjie #60)
- `--once` now respects `--jobs`, so it can run jobs in parallel
- `jobKey` is now available via TypeScript API (@tim-field, #78)

Other:

- Overhauled the `perfTest` script
- Upgraded dependencies

### v0.3.0-rc.0

v0.3.0-rc.0 was never released as v0.3.0 because we jumped to v0.4.0 too soon.

New features:

- `job_key` enables existing jobs to be updated and deleted; can also be used for de-duplication (@gregplaysguitar, @benjie #63)

Fixes:

- Fixes `runner.stop()` (@MarkCBall, #66)

### v0.2.0

BREAKING CHANGES:

- The `debug` task helper has been replaced with a `logger` helper which is a `Logger` instance (see README)
- The `-1` shortcut for "run once" never worked; it has been removed
- Unrecognised command-line arguments will now cause an error to be thrown

New features:

- Added `--schema-only` CLI flag for installing/updating the schema (running migrations) only
- It's now possible to override how logs are output by supplying a `logFactory` (see README)
- `query` helper reduces boilerplate

Fixes:

- We never needed `uuid-ossp` so we've removed the requirement (you may want to remove the extension from your DB manually)

### v0.1.0

- Add database 'error' handler to avoid crashes (@madflow #26)
- `DATABASE_URL` can now be used in place of `connectionString` (@madflow, @benjie ~~#20~~ #27)
- Improve documentation (@madflow, @archlemon, @benjie #11 #18 #31 #33)
- Improve testing (@madflow #19 #30)

### v0.1.0-alpha.0

Now usable as a library as well as a CLI.

Changes:

- Renamed a number of internals
  - `start` -> `runTaskList`
  - `runAllJobs` -> `runTaskListOnce`
  - `workerCount` -> `concurrency`
- Add an easy way to run as a library (`run` and `runOnce` methods)
- CLI code reduced as it uses new library code
- Implemented linting
- Exported more methods

### v0.0.1-alpha.7

- Add missing `tslib` dependency

### v0.0.1-alpha.6

- make poll interval configurable
- overhaul TypeScript types/interfaces
- more docs

### v0.0.1-alpha.5

- Fix casting (REQUIRES DB RESET)

### v0.0.1-alpha.4

- add `addJob` helper

### v0.0.1-alpha.3

- Travis CI
- Add `index.js`

### v0.0.1-alpha.2

- Docs

### v0.0.1-alpha.1

- More efficient job trigger
- Reduce latency

### v0.0.1-alpha.0

Initial release.
