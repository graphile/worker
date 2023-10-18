# Release notes

### v0.16.0

**DROPS SUPPORT FOR NODE <18**. As of 24th October 2023, Node 20 is the active
LTS and Node 18 is maintainence LTS; previous versions are no longer supported.

Adds support for `graphile-config` - configuration can now be read from a
`graphile.config.ts` (or `.js`, `.cjs`, etc) file.

### v0.15.1

Fixes issues with graceful worker shutdowns:

- Deprecates `workerPool.release()` in favour of (equivalent)
  `workerPool.gracefulShutdown()`
- Fixes `workerPool.gracefulShutdown()` to shut down gracefully (waiting for
  jobs to complete)
- Adds `workerPool.forcefulShutdown()` to "fail" the running jobs (so they'll be
  re-attempted elsewhere) and force-release the pool
- Fixes handling of signals:
  - First termination signal triggers graceful shutdown
  - Signal over next 5 seconds are ignored
  - Second termination signal triggers forceful shutdown
  - Signal over next 5 seconds are ignored
  - Further termination signals are handled by Node (i.e. will likely instantly
    exit the process)

### v0.15.0

Migration files are no longer read from filesystem (via `fs` module); instead
they are stored as strings in JS to enable Graphile Worker to be bundled. The
files still exist and will continue to be distributed, so this should not be a
breaking change. Thanks to @timelf123 for this feature!

### v0.14.0

**THIS RELEASE INTRODUCES SIGNIFICANT CHANGES**, in preparation for moving
towards the 1.0 release. Please read these notes carefully.

**IMPORTANT**: this release is incompatible with previous releases - do not run
earlier workers against this releases database schema or Bad Things will happen.

**IMPORTANT**: the initial migration, `000011`, in this release cannot run if
there are any locked jobs - it will throw a "division by zero" error in this
case. Please ensure all existing workers are shut down and any locked jobs
released before upgrading to this version.

**IMPORTANT**: migration `000011` renames the old jobs table, creates a new jobs
table with a slightly different format, copies the jobs across, and then deletes
the old jobs table. The jobs table itself is not a public interface - you should
use the documented SQL functions and TypeScript APIs only - but if you are
referencing the jobs table in a database function you may have a bad time.

**IMPORTANT**: `priority`, `attempts` and `max_attempts` are all now `smallint`,
so please make sure that your values fit into these ranges before starting the
migration process. (Really these values should never be larger than about `100`
or smaller than about `-100` anyway.)

#### Breaking changes

- BREAKING: Bump minimum Node version to 14 since 12.x is now end-of-life
- BREAKING: Bump minimum PG version to 12 for `generated always as (expression)`
- BREAKING: `jobs.priority`, `attempts` and `max_attempts` are now `int2` rather
  than `int4` (please ensure your values fit in `int2` -
  `-32768 <= priority <= +32767`)
- BREAKING: CronItem.pattern has been renamed to CronItem.match
- BREAKING: database error codes have been removed because we've moved to
  `CHECK` constraints

#### Changes to internals

- WARNING: the 'jobs' table no longer has `queue_name` and `task_identifier`
  columns; these have been replaced with `job_queue_id` and `task_id` which are
  both `int`s
- WARNING: many of the "internal" SQL functions (`get_job`, `fail_job`,
  `complete_job`) have been moved to JS to allow for dynamic SQL generation for
  improved performance/flexibility
- WARNING: most of the triggers have been removed (for performance reasons), so
  if you are inserting directly into the jobs table (don't do that, it's not a
  supported interface!) make sure you update your code to be compatible

#### Features

- New "batch jobs" feature for merging payloads with a `job_key` (see README)
- Significantly improved 'large jobs table' performance (e.g. when a large queue
  is locked, or there's a lot of jobs queued for task identifiers your worker
  instance doesn't support, or a lot of failed jobs). Around 20x improvement in
  this 'worst case' performance for real user workloads.
- Added new (experimental) much faster `add_jobs` batch API.
- Fix error handling of cron issues in 'run' method.
- CronItem.match can now accept either a pattern string or a matcher function
- Jobs that were locked more than 4 hours will be reattempted as before, however
  they are slightly de-prioritised by virtue of having their `run_at` updated,
  giving interim jobs a chance to be executed (and lessening the impact of queue
  stalling through hanging tasks).

### v0.13.0

- Remove dependency on `pgcrypto` database extension (thanks @noinkling)
  - If you have a pre-existing installation and wish to uninstall `pgcrypto` you
    will need to do so manually. This can be done by running
    `DROP EXTENSION pgcrypto;` _after_ updating to the latest schema.
- The `jobs.queue_name` column no longer has a default value (this is only
  relevant to people inserting into the table directly, which is not
  recommended - use the `add_job` helper)

### v0.12.2

- Fix issue when a connect error occurs whilst releasing worker (thanks
  @countcain)

### v0.12.1

- Jobs with no queue are now released during graceful shutdown (thanks @olexiyb)

### v0.12.0

- Run shutdown actions in reverse order (rather than parallel) - more stable
  release
- When an error occurs with the new job listener, reconnection attempts now
  follow an exponential back-off pattern
- Allow using Node.js time rather than PostgreSQL time (particularly useful for
  tests)
- Refactoring of some cron internals
- Add `noPreparedStatements` to the docs

### v0.11.4

- Fixes bug in crontab day-of-week check
- Exposes `parseCronItem` helper

### v0.11.3

- Restores `Logger` export accidentally removed in v0.11.0

### v0.11.2

- Added support for wider range of `@types/pg` dependency

### v0.11.1

- Handles unexpected errors whilst PostgreSQL client is idle

### v0.11.0

- Export `getCronItems` so library-mode users can watch the crontab file
- Replace `Logger` with new
  [`@graphile/logger`](https://github.com/graphile/logger) module

### v0.10.0

- No longer exit on SIGPIPE (Node will swallow this error code)
- Fix issue with error handling on PostgreSQL restart or `pg_terminate_backend`
- Fix a potential unhandled promise rejection

### v0.9.0

- New (experimental) "cron" functionality for regularly scheduled jobs
- Replace jobs ordering index for improved performance (thanks @ben-pr-p)
  - NOTE: this migration might take a moment if you have a large jobs table
- New events system lets you monitor what's going on inside Graphile Worker
- New `job_key_mode` setting; see README for full details, but summary:
  - defaults to `replace` (existing behavior, i.e. debouncing)
  - if set to `preserve_run_at` it will preserve `run_at` which effectively
    changes it from debouncing to throttling
  - if set to `unsafe_dedupe` it will not update the attributes when an existing
    job with that job key exists, even if that job is already running
- `remove_job` now prevents locked jobs from running again on error (and removes
  their key)
- Dependency updates

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
