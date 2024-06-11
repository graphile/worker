# Release notes

## Worker Pro: easing migration

From time to time Graphile Worker needs to make changes to the database, and
these changes might cause pre-existing workers to fail in "interesting" ways.
These breaking changes are noted in the release notes below, and typically you
need to "scale to zero" to perform these updates - turn off all your existing
workers and only then run only new workers.

Worker Pro is a proprietary plugin which, among other things, helps to alleviate
this issue. It tracks the running workers and when a new breaking migration is
required it has all old workers exit cleanly (once they've finished what they're
working on) and no further old workers will be able to start up. Once all old
workers have exited, the migration can go ahead as it normally would. This
avoids the need to "scale to zero" as workers will communicate with each other
to make sure the system as a whole remains consistent.

Read more:
[Worker Pro Migration](https://worker.graphile.org/docs/pro/migration).

## Pending

- BREAKING: Jobs and queues are now `locked_by` their `WorkerPool`'s id rather
  than the `workerId`. Be sure to upgrade
  [Worker Pro](https://worker.graphile.org/docs/pro) at the same time if you're
  using it!
- Fixes bug where CLI defaults override `graphile.config.js` settings (by
  removing CLI defaults)

## v0.16.6

- Fix bug in `workerUtils.cleanup()` where queues would not be cleaned up if
  there existed any job that was not in a queue
- If errors happen writing to stdout/stderr (e.g. `SIGPIPE`), we'll trigger a
  graceful shutdown (and swallow further errors)
- `workerUtils.cleanup({ tasks: ['GC_TASK_IDENTIFIERS'] })` now allows you to
  specify additional task identifiers to keep (`taskIdentifiersToKeep: [...]`)
  in order to reduce impact on other workers
- `graphile-worker --cleanup GC_TASK_IDENTIFIERS` will attempt to keep all
  locally defined task identifiers

## v0.16.5

- Add "timeout" to list of retryable error codes - thanks @psteinroe

## v0.16.4

- Hotfix: remove website dependencies from worker module dependencies

## v0.16.3

- Add "cannot connect now" to list of retryable error codes - thanks @psteinroe

## v0.16.2

- Fix loading tasks on Windows (use URLs rather than file paths) - thanks
  @hiepxanh
- Add `cleanup` function to remove unused queues, stale task identifiers, and
  permanently failed jobs - thanks @christophemacabiau
- Fix logger scope for workers - thanks @jcapcik
- Add `helpers.getQueueName()` to retrieve the queue name of the currently
  running job
- Automatically retry certain internal operations on serialization failure or
  deadlock detection (useful if you have changed your
  `default_transaction_isolation` to `serializable` or similar)

## v0.16.1

- Fixes issue importing task files that were written in TypeScript ESM format
  but exported as CommonJS.

## v0.16.0

_There's a breakdown of these release notes available on the new
[Worker Website](https://worker.graphile.org/news/2023-12-11-016-release), where
we go into more detail about the headline features._

**THIS RELEASE INTRODUCES SIGNIFICANT CHANGES**, in preparation for moving
towards the 1.0 release. Please read these notes carefully.

**IMPORTANT**: this release is incompatible with previous releases - do not run
earlier workers against this releases database schema or Bad Things will happen.
You should shut down all workers before migrating to this version, or use
[Worker Pro](https://worker.graphile.org/docs/pro). (If you're upgrading from
v0.13.0, upgrade to v0.13.1-bridge.0 first and add the Worker Pro plugin to
that; deploy it across your fleet, and then proceed to upgrade to v0.16.0.)

### General Migration Warnings

- 🚨 Drops support for node <18
  - As of 24th October 2023, Node 20 is the active LTS and Node 18 is
    maintainence LTS; previous versions are no longer supported
- 🚨 Renames all of the tables `graphile_worker.*` to
  `graphile_worker._private_*`
  - We might change these tables in a patch release
  - This has always been the case, these are not a public interface
  - New naming makes it clear that you should not use them and should not rely
    on their schema being stable
- 🚨 Removes `maxContiguousErrors`
  - It wasn't fit for purpose, so best to remove it for now
  - See #307 for more details
- 🚨 Removes `--watch` and watch mode in general
  - Now signal handling is improved and with people wanting to use ESM to define
    modules, it's finally time to remove the experimental watch mode
  - Use `node --watch` or `nodemon` or similar instead
  - `crontab` file is also not watched, so be sure to watch that too!
  - Fixes a lot of weirdness that can happen when you attempt to hot-reload
    tasks
- 🚨 Breaking TypeScript changes
  - Lots of `any` changed to `unknown`
    - In particular, errors in the event emitter payloads are now `unknown`
      rather than `any`, so you might need to cast
  - Payload is now marked as required in `addJob()`
    - Set to `{}` if your task doesn't need a payload

### New features

- Graphile Config and new plugin system
  - Worker is now optionally
    [configurable](https://worker.graphile.org/docs/config) with
    `graphile-config` - configuration can now be read from a
    `graphile.config.ts` (or `.js`, `.cjs`, etc) file
  - This enables a whole suite of new options and features, including being able
    to share your preset files across multiple projects!
  - New plugin hooks added - get in touch if you need more!
  - E.g. allows you to replace the task loading code entirely with your own
    implementation!
- Support for loading tasks from nested folders
  - (`tasks/users/email/verify.js` will identify task `users/email/verify`)
- Native ESM support
  - Enabled by the plugin system
  - Support for loading both CommonJS and ESM files (including `.cjs`, `.mjs`
    and `.js` extensions)
- Compile-to-JS language support
  - Any "compile-to-JS" language can be `import()`ed
  - Ensure the relevant "loaders" are available
  - e.g. for native TypeScript support you might use
    `NODE_OPTIONS="--loader ts-node/esm" npx graphile-worker`
  - List the extensions you support in the
    [configuration file](https://worker.graphile.org/docs/config#workerfileextensions)
- Tasks in non-JS languages (EXPERIMENTAL!)
  - Enabled by the plugin system
  - Any language your shell can execute: python, bash, rust, ...
  - Place an executable file in the `tasks/` folder and ensure it's named with
    the task identifier (extensions ignored)
  - See
    [Loading executable files](https://worker.graphile.org/docs/tasks#loading-executable-files)
    in the documentation
- `abortSignal`: job cancellation (EXPERIMENTAL!)
  - Tasks can honour the `abortSignal` passed in via helpers to cancel
    asynchronous work on `gracefulShutdown`
  - Can reduce waiting for the task to complete during a graceful shutdown; task
    executor can listen for the `abortSignal` and decided whether to exit or
    continue
- TypeScript typing of tasks
  - New `GraphileWorker.Tasks` global interface
  - Not recommended, but often requested!
  - Types calls to `addJob()` and `quickAddJob()`, and types task executors
  - Read
    [the caveats in the documentation](https://worker.graphile.org/docs/typescript)
- Adds `graphile_worker.jobs` view
  - A public interface to view details of jobs
  - Stable across patch and minor versions
  - DELIBERATELY excludes the `payload` field
  - Do not poll this, it will impact performance
  - Do not do expensive filtering/ordering against this, it will impact
    performance
- New public `force_unlock_workers` database function
  - Unlocks all jobs from a list of crashed/terminated worker IDs
- Crontab: now supports `jobKey` and `jobKeyMode` opts (thanks @spiffytech!)
- Schema
  - Checks that current schema in database isn't more up to date than the
    current worker
    - Won't be useful until future schema changes
  - Trigger a graceful shutdown if a new Graphile Worker process migrates the
    database schema
- Events: add more detail to `cron:backfill` event
- Tasks: now use `await import(...)` rather than `require(...)`, so ESM can be
  imported
- Logging: changed format of task completion/failure logs to include
  attempts/max attempts and to reduce duplicate parenthesis
- Optimization: Replaces job announcement trigger with calls directly in
  `add_job` / `add_jobs` to reduce queuing overhead

### Fixes

- Fixes graceful shutdown (both manually via `.gracefulShutdown()` or
  `.forcefulShutdown()` and via signal handling)
- Signals: now releases signal handlers when shut down via the API
- Fixes bug where queuing 100 jobs in a single statement would only nudge a
  single inactive worker
  - Now as many workers as necessary and available will be nudged

## v0.15.2-bridge.0

**TL;DR: if you want to use [Worker Pro](https://worker.graphile.org/docs/pro)
to ease migration to v0.16.0, upgrade to this version if you're on v0.14.0 or
higher, or v0.13.1-bridge.0 if you're on v0.13.0 or lower for Worker Pro
support.**

This release is a "bridge" release to make migration to v0.16.0 easier. Since
v0.16.0 includes breaking database changes, no active workers should be running
when the migrations happen, and once the migrations have happened older workers
are no longer supported and their usage may lead to weird and undesirable
behaviors.

Normally we'd recommend that you "scale to zero" before performing these kinds
of migrations, to ensure that no older workers will be running against the DB at
the same time; however this release adds support for the (proprietary)
[Worker Pro plugin](https://worker.graphile.org/docs/pro) which (when used
consistently across your entire worker fleet) enables your workers to
coordinate, triggering legacy workers to cleanly shut down (and waiting for them
to do so) before migrating the database. The Worker Pro plugin also details the
intent to upgrade, meaning if new legacy workers start up in the interrim, they
will also not start looking for jobs since they know they will be out of date
soon. As soon as all running tasks have finished processing (or a configurable
timeout has elapsed) the migration will go ahead.

The Worker Pro plugin mentioned above is enabled by the addition of support for
`graphile-config`, the standardized plugin and preset system for the entire
Graphile suite. Thanks to this integration, we've been able to add a
plugin/hooks system that you can use to customize the behavior of Worker
(including implementing some of the behaviors described in the previous
paragraph yourself, should you so desire).

This release also adds a startup check that will abort startup if the database
already contains breaking migrations that are unsupported by the current worker
version, and a significant number of back-ported fixes and new features that
didn't require database migrations (including important fixes to the graceful
shutdown system).

**IMPORTANT**: `--watch` mode is no longer supported. We've removed this from
v0.16.0 (see the release notes for that version), you should use `node --watch`
or similar instead. This also removes `fauxRequire` and all the problems that
that had.

**IMPORTANT**: Node versions before v20 and Postgres versions before v12 are no
longer supported. (Node v18 _should_ work, but it segfaults when running the
tests which is likely a jest/`node --experimental-vm-modules` issue which is
unlikely affect you at runtime.)

- Fixes graceful shutdown (both manually via `.gracefulShutdown()` or
  `.forcefulShutdown()` and via signal handling)
- Removes `maxContinguousErrors` setting which was poorly implemented and caused
  more issues than it solved
- Tracks whether migrations are breaking or not, and:
  - refuses to start if an unsupported breaking migration is present in the
    database
  - gracefully shuts down if another worker performs a breaking migration
    - NOTE: this is not sufficiently safe, it's just a backstop. If the
      migration breaks completing or failing of jobs then your worker will be
      unable to release in-progress tasks even if they're finished; and the
      worker performing the migrations will not wait for legacy workers to
      complete. You should shut down your workers before upgrading, or use
      Worker Pro to handle the situation automatically for you.
- Adds `graphile-config` support for presets and plugins
- Adds more events and hooks
- `runTaskListOnce` now uses a WorkerPool internally (to better integrate with
  the gracefulShutdown logic)
- Fix `WorkerPool.promise` to only resolve once everything is handled
- EXPERIMENTAL; see v0.16.0 for documentation:
  - Adds support for loading tasks from nested folders (e.g.
    `tasks/foo/bar/baz.js` will add support for a task with identifier
    `foo/bar/baz`)
  - Adds support for turning executable files into tasks (i.e. a task written in
    python, Rust, or bash)
  - Adds support for loading TypeScript tasks directly (no need to compile to
    JS, but if you do the JS will have priority)
  - You may see warnings like
    `WARNING: Failed to load task 'README.md' - no supported handlers found for path: '/path/to/tasks/README.md'` -
    you can ignore them (or you can move non-task files out of the `tasks`
    folder)
  - Undocumented, experimental and untested preliminary support for cancellable
    jobs via `AbortSignal`; upgrade to v0.16.0+ if you want to actually use this
- A huge number of internal changes

## v0.15.1

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

## v0.15.0

Migration files are no longer read from filesystem (via `fs` module); instead
they are stored as strings in JS to enable Graphile Worker to be bundled. The
files still exist and will continue to be distributed, so this should not be a
breaking change. Thanks to @timelf123 for this feature!

## v0.14.0

**THIS RELEASE INTRODUCES SIGNIFICANT CHANGES**, in preparation for moving
towards the 1.0 release. Please read these notes carefully.

**IMPORTANT**: this release is incompatible with previous releases - do not run
earlier workers against this releases database schema or Bad Things will happen.
You should shut down all workers before migrating to this version.

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

### Breaking changes

- BREAKING: Bump minimum Node version to 14 since 12.x is now end-of-life
- BREAKING: Bump minimum PG version to 12 for `generated always as (expression)`
- BREAKING: `jobs.priority`, `attempts` and `max_attempts` are now `int2` rather
  than `int4` (please ensure your values fit in `int2` -
  `-32768 <= priority <= +32767`)
- BREAKING: CronItem.pattern has been renamed to CronItem.match
- BREAKING: database error codes have been removed because we've moved to
  `CHECK` constraints

### Changes to internals

- WARNING: the 'jobs' table no longer has `queue_name` and `task_identifier`
  columns; these have been replaced with `job_queue_id` and `task_id` which are
  both `int`s
- WARNING: many of the "internal" SQL functions (`get_job`, `fail_job`,
  `complete_job`) have been moved to JS to allow for dynamic SQL generation for
  improved performance/flexibility
- WARNING: most of the triggers have been removed (for performance reasons), so
  if you are inserting directly into the jobs table (don't do that, it's not a
  supported interface!) make sure you update your code to be compatible

### Features

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

## v0.13.1-bridge.0

**TL;DR: if you want to use [Worker Pro](https://worker.graphile.org/docs/pro)
to ease migration to v0.16.0, upgrade to this version for Worker Pro support.**

This release is a "bridge" release to make migration to v0.14.0 and v0.16.0
easier. Since v0.14.0 and v0.16.0 include breaking database changes, no active
workers should be running when the migrations happen, and once the migrations
have happened older workers are no longer supported and their usage may lead to
weird and undesirable behaviors.

Normally we'd recommend that you "scale to zero" before performing these kinds
of migrations, to ensure that no older workers will be running against the DB at
the same time; however this release adds support for the (proprietary)
[Worker Pro plugin](https://worker.graphile.org/docs/pro) which (when used
consistently across your entire worker fleet) enables your workers to
coordinate, triggering legacy workers to cleanly shut down (and waiting for them
to do so) before migrating the database. The Worker Pro plugin also details the
intent to upgrade, meaning if new legacy workers start up in the interrim, they
will also not start looking for jobs since they know they will be out of date
soon. As soon as all running tasks have finished processing (or a configurable
timeout has elapsed) the migration will go ahead.

The Worker Pro plugin mentioned above is enabled by the addition of support for
`graphile-config`, the standardized plugin and preset system for the entire
Graphile suite. Thanks to this integration, we've been able to add a
plugin/hooks system that you can use to customize the behavior of Worker
(including implementing some of the behaviors described in the previous
paragraph yourself, should you so desire).

This release also adds a startup check that will abort startup if the database
already contains breaking migrations that are unsupported by the current worker
version, and a significant number of back-ported fixes and new features that
didn't require database migrations (including important fixes to the graceful
shutdown system).

**IMPORTANT**: `--watch` mode is no longer supported. We've removed this from
v0.16.0 (see the release notes for that version), you should use `node --watch`
or similar instead. This also removes `fauxRequire` and all the problems that
that had.

**IMPORTANT**: Node versions before v20 and Postgres versions before v12 are no
longer supported. (Node v18 _should_ work, but it segfaults when running the
tests which is likely a jest/`node --experimental-vm-modules` issue which is
unlikely affect you at runtime.)

- Fixes graceful shutdown (both manually via `.gracefulShutdown()` or
  `.forcefulShutdown()` and via signal handling)
- Removes `maxContinguousErrors` setting which was poorly implemented and caused
  more issues than it solved
- Tracks whether migrations are breaking or not, and:
  - refuses to start if an unsupported breaking migration is present in the
    database
  - gracefully shuts down if another worker performs a breaking migration
    - NOTE: this is not sufficiently safe, it's just a backstop. If the
      migration breaks completing or failing of jobs then your worker will be
      unable to release in-progress tasks even if they're finished; and the
      worker performing the migrations will not wait for legacy workers to
      complete. You should shut down your workers before upgrading, or use
      Worker Pro to handle the situation automatically for you.
- Adds `graphile-config` support for presets and plugins
- Adds more events and hooks
- Uses JS-ified SQL migrations to help workaround some bundling issues
- `runTaskListOnce` now uses a WorkerPool internally (to better integrate with
  the gracefulShutdown logic)
- Fix `WorkerPool.promise` to only resolve once everything is handled
- EXPERIMENTAL; see v0.16.0 for documentation:
  - Adds support for loading tasks from nested folders (e.g.
    `tasks/foo/bar/baz.js` will add support for a task with identifier
    `foo/bar/baz`)
  - Adds support for turning executable files into tasks (i.e. a task written in
    python, Rust, or bash)
  - Adds support for loading TypeScript tasks directly (no need to compile to
    JS, but if you do the JS will have priority)
  - You may see warnings like
    `WARNING: Failed to load task 'README.md' - no supported handlers found for path: '/path/to/tasks/README.md'` -
    you can ignore them (or you can move non-task files out of the `tasks`
    folder)
  - Undocumented, experimental and untested preliminary support for cancellable
    jobs via `AbortSignal`; upgrade to v0.16.0+ if you want to actually use this
- A huge number of internal changes

## v0.13.0

- Remove dependency on `pgcrypto` database extension (thanks @noinkling)
  - If you have a pre-existing installation and wish to uninstall `pgcrypto` you
    will need to do so manually. This can be done by running
    `DROP EXTENSION pgcrypto;` _after_ updating to the latest schema.
- The `jobs.queue_name` column no longer has a default value (this is only
  relevant to people inserting into the table directly, which is not
  recommended - use the `add_job` helper)

## v0.12.2

- Fix issue when a connect error occurs whilst releasing worker (thanks
  @countcain)

## v0.12.1

- Jobs with no queue are now released during graceful shutdown (thanks @olexiyb)

## v0.12.0

- Run shutdown actions in reverse order (rather than parallel) - more stable
  release
- When an error occurs with the new job listener, reconnection attempts now
  follow an exponential back-off pattern
- Allow using Node.js time rather than PostgreSQL time (particularly useful for
  tests)
- Refactoring of some cron internals
- Add `noPreparedStatements` to the docs

## v0.11.4

- Fixes bug in crontab day-of-week check
- Exposes `parseCronItem` helper

## v0.11.3

- Restores `Logger` export accidentally removed in v0.11.0

## v0.11.2

- Added support for wider range of `@types/pg` dependency

## v0.11.1

- Handles unexpected errors whilst PostgreSQL client is idle

## v0.11.0

- Export `getCronItems` so library-mode users can watch the crontab file
- Replace `Logger` with new
  [`@graphile/logger`](https://github.com/graphile/logger) module

## v0.10.0

- No longer exit on SIGPIPE (Node will swallow this error code)
- Fix issue with error handling on PostgreSQL restart or `pg_terminate_backend`
- Fix a potential unhandled promise rejection

## v0.9.0

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

## v0.8.1

- Fix issue with cyclic requires in watch mode

## v0.8.0

- Track revision count for jobs (thanks @lukeramsden)
- ["Forbidden flags"](https://github.com/graphile/worker#forbidden-flags)
  feature for rate limiting (thanks @ben-pr-p)
- Fix incorrect description of priority - numerically smaller numbers run first
  (thanks @ben-pr-p)
- Add support for `PG*`
  [PostgreSQL envvars](https://www.postgresql.org/docs/current/libpq-envars.html)

## v0.7.2

- Add `--no-prepared-statements` flag to allow disabling of prepared statements
  for pgBouncer compatibility.
- Fix issue in watch mode where files `require()`d from inside a task are cached
  permanently.

(v0.7.0 and v0.7.1 had issues with the experimental watch mode enhancements, so
were never upgraded to `@latest`.)

## v0.6.1

- Official Docker image (thanks @madflow)

## v0.6.0

- Use target es2018 for TypeScript (Node v10 supports everything we need)
  (thanks @keepitsimple)
- When task promise is rejected with non-Error, use a fallback (thanks
  @parker-torii)
- Support `pg@8.x` and hence Node v14 (thanks @purge)
- Fix mistake in README
- General maintenance

## v0.5.0

New "Administrative functions", ability to rename `graphile_worker` schema, and
significant overhaul of the codebase in preparation for going to v1.0.

### v0.5.0 improvements:

- Added "Administrative functions" to complete, reschedule or fail jobs in bulk
  (good for UIs)
- Added `noHandleSignals` option to disable our signal handling (if you enable
  this, make sure you use your own signal handling!)
- Ability to rename `graphile_worker` schema
- Added `cosmiconfig` for configuration (very few options support this
  currently)
- Decrease already negligible chance of worker ID collision (use
  `crypto.randomBytes()` rather than `Math.random()`)

### v0.5.0 breaking changes:

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

## v0.4.0

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

## v0.3.0-rc.0

v0.3.0-rc.0 was never released as v0.3.0 because we jumped to v0.4.0 too soon.

New features:

- `job_key` enables existing jobs to be updated and deleted; can also be used
  for de-duplication (@gregplaysguitar, @benjie #63)

Fixes:

- Fixes `runner.stop()` (@MarkCBall, #66)

## v0.2.0

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

## v0.1.0

- Add database 'error' handler to avoid crashes (@madflow #26)
- `DATABASE_URL` can now be used in place of `connectionString` (@madflow,
  @benjie ~~#20~~ #27)
- Improve documentation (@madflow, @archlemon, @benjie #11 #18 #31 #33)
- Improve testing (@madflow #19 #30)

## v0.1.0-alpha.0

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

## v0.0.1-alpha.7

- Add missing `tslib` dependency

## v0.0.1-alpha.6

- make poll interval configurable
- overhaul TypeScript types/interfaces
- more docs

## v0.0.1-alpha.5

- Fix casting (REQUIRES DB RESET)

## v0.0.1-alpha.4

- add `addJob` helper

## v0.0.1-alpha.3

- Travis CI
- Add `index.js`

## v0.0.1-alpha.2

- Docs

## v0.0.1-alpha.1

- More efficient job trigger
- Reduce latency

## v0.0.1-alpha.0

Initial release.
