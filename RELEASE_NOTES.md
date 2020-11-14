# Release notes

### Pending

- Add your changes here
- TypeScript: make the `Task` type generic, to allow specifying payloads

### v0.8.1

- Fix issue with cyclic requires in watch mode

### v0.8.0

- Track revision count for jobs (thanks @lukeramsden)
- ["Forbidden flags"](https://github.com/graphile/worker#forbidden-flags)
  feature for rate limiting (thanks @ben-pr-p)
- Fix incorrect description of priority - numerically smaller numbers run first
  (thanks @ben-pr-p)
- Add support for `PG*`
  [PostgreSQL envvars](https://www.postgresql.org/docs/current/libpq-envars.html)

### v0.7.2

- Add `--no-prepared-statements` flag to allow disabling of prepared statements
  for pgBouncer compatibility.
- Fix issue in watch mode where files `require()`d from inside a task are cached
  permanently.

(v0.7.0 and v0.7.1 had issues with the experimental watch mode enhancements, so
were never upgraded to `@latest`.)

### v0.6.1

- Official Docker image (thanks @madflow)

### v0.6.0

- Use target es2018 for TypeScript (Node v10 supports everything we need)
  (thanks @keepitsimple)
- When task promise is rejected with non-Error, use a fallback (thanks
  @parker-torii)
- Support `pg@8.x` and hence Node v14 (thanks @purge)
- Fix mistake in README
- General maintenance

### v0.5.0

New "Administrative functions", ability to rename `graphile_worker` schema, and
significant overhaul of the codebase in preparation for going to v1.0.

#### v0.5.0 improvements:

- Added "Administrative functions" to complete, reschedule or fail jobs in bulk
  (good for UIs)
- Added `noHandleSignals` option to disable our signal handling (if you enable
  this, make sure you use your own signal handling!)
- Ability to rename `graphile_worker` schema
- Added `cosmiconfig` for configuration (very few options support this
  currently)
- Decrease already negligible chance of worker ID collision (use
  `crypto.randomBytes()` rather than `Math.random()`)

#### v0.5.0 breaking changes:

**CLI users**: no breaking changes.

**Library users**: none of the documented (in the README) APIs are affected,
except `runTaskListOnce` and some tiny tweaks to TypeScript types.

The ability to override the SQL schema means that everything in the codebase
needs to know this setting. To achieve this:

- all major APIs now accept `options` as a configuration parameter
- where this was optional before it is now required
- where options was not the first argument, it has been moved to the first
  argument (for consistency)

As such the following APIs (most of which are internal) have been changed:

- `getTasks(taskPath, watch, logger)` -> `getTasks(options, taskPath, watch)`
- `runTaskList(tasks, pgPool, options?)` ->
  `runTaskList(options, tasks, pgPool)`
- `runTaskListOnce(tasks, client, options?)` ->
  `runTaskList(options, tasks, client)`
- `migrate(client)` -> `migrate(options, client)`
- `makeAddJob(withPgClient)` -> `makeAddJob(options, withPgClient)`
- `makeJobHelpers(job, { withPgClient }, baseLogger)` ->
  `makeJobHelpers(options, job, { withPgClient, logger? })`
- `makeNewWorker(tasks, withPgClient, options, continuous)` ->
  `makeNewWorker(options, tasks, withPgClient, continuous)`

Also if you're a TypeScript user: we've renamed `WorkerSharedOptions` to
`SharedOptions` and added a new `WorkerSharedOptions`. This is particularly
relevant if you're using the `WorkerUtils` class. We've also tweaked what
options are available on each of these, but this is unlikely to affect you
negatively.

### v0.4.0

Performance improvements and ability to efficiently queue jobs from JS.

BREAKING CHANGES:

- TypeScript:
  - the ID of a job is a `string` (database `bigint`), we previously incorrectly
    stated it was a `number`.
  - `Helpers` was renamed to `JobHelpers`
  - `TaskOptions` was renamed to `TaskSpec`
- `queue_name` is now nullable (leave it null for maximum parallel performance)
- when a job is modified using a `job_key`, the `queue_name` attribute is now
  reset like the other attributes

WARNINGS:

- The database schema has changed; your code should not depend on the database
  schema, only on the public interfaces (`add_job`, `remove_job`, etc), so this
  shouldn't be an issue.

New features:

- Significantly enhanced performance
  - Changes database schema such that a job_queue record is only added/checked
    when necessary
  - Uses prepared statements
  - Can override the PostgreSQL pool size on the CLI (via `--max-pool-size`)
- Dedicated API for queueing jobs from JavaScript/TypeScript (`makeWorkerUtils`
  / `quickAddJob`; @mrmurphy, @benjie #60)
- `--once` now respects `--jobs`, so it can run jobs in parallel
- `jobKey` is now available via TypeScript API (@tim-field, #78)

Other:

- Overhauled the `perfTest` script
- Upgraded dependencies

### v0.3.0-rc.0

v0.3.0-rc.0 was never released as v0.3.0 because we jumped to v0.4.0 too soon.

New features:

- `job_key` enables existing jobs to be updated and deleted; can also be used
  for de-duplication (@gregplaysguitar, @benjie #63)

Fixes:

- Fixes `runner.stop()` (@MarkCBall, #66)

### v0.2.0

BREAKING CHANGES:

- The `debug` task helper has been replaced with a `logger` helper which is a
  `Logger` instance (see README)
- The `-1` shortcut for "run once" never worked; it has been removed
- Unrecognised command-line arguments will now cause an error to be thrown

New features:

- Added `--schema-only` CLI flag for installing/updating the schema (running
  migrations) only
- It's now possible to override how logs are output by supplying a `logFactory`
  (see README)
- `query` helper reduces boilerplate

Fixes:

- We never needed `uuid-ossp` so we've removed the requirement (you may want to
  remove the extension from your DB manually)

### v0.1.0

- Add database 'error' handler to avoid crashes (@madflow #26)
- `DATABASE_URL` can now be used in place of `connectionString` (@madflow,
  @benjie ~~#20~~ #27)
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
