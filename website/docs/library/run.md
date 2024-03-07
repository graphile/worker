---
title: "Library: running jobs"
sidebar_position: 60
sidebar_label: "Running jobs"
---

`graphile-worker` can be used as a library inside your Node.js application.
There are two main use cases for this: running jobs, and queueing jobs. Here are
the APIs for running jobs.

## `run()`

```ts
function run(options: RunnerOptions): Promise<Runner>;
```

Runs until either stopped by a signal event like `SIGINT` or by calling the
`stop()` method on the resolved object.

The resolved &lsquo;Runner&rsquo; object has a number of helpers on it, see
[Runner](#runner) for more information.

## `runOnce()`

```ts
function runOnce(options: RunnerOptions): Promise<void>;
```

Equivalent to running the CLI with the `--once` flag. The function will run
until there are no runnable jobs left, and then resolve.

## `runMigrations()`

```ts
function runMigrations(options: RunnerOptions): Promise<void>;
```

Equivalent to running the CLI with the `--schema-only` option. Runs the
migrations and then resolves.

## `RunnerOptions`

The following options for these methods are available.

- `concurrency`: The equivalent of the CLI `--jobs` option with the same default
  value.
- `noHandleSignals`: If set true, we won&apos;t install signal handlers and
  it&apos;ll be up to you to handle graceful shutdown of the worker if the
  process receives a signal.
- `pollInterval`: The equivalent of the CLI `--poll-interval` option with the
  same default value.
- `logger`: To change how log messages are output you may provide a custom
  logger; see [`Logger`](./logger.md).
- the database is identified through one of these options:
  - `connectionString`: A PostgreSQL
    [connection string](../connection-string.md) to the database containing the
    job queue, or
  - `pgPool`: A `pg.Pool` instance to use.
- the tasks to execute are identified through one of these options:
  - `taskDirectory`: A path string to a directory containing the task handlers.
  - `taskList`: An object with the task names as keys and a corresponding task
    handler functions as values.
- `schema` can be used to change the default `graphile_worker` schema to
  something else (equivalent to `--schema` on the CLI).
- `forbiddenFlags` see [Forbidden flags](../forbidden-flags.md).
- `events`: pass your own `new EventEmitter()` if you want to customize the
  options, get earlier events (before the runner object resolves), or want to
  get events from alternative Graphile Worker entrypoints.
- `noPreparedStatements`: Set true if you want to prevent the use of prepared
  statements, for example if you wish to use Graphile Worker with an external
  PostgreSQL connection pool. Enabling this setting may have a small performance
  impact.

Exactly one of either `taskDirectory` or `taskList` must be provided (except for
`runMigrations` which doesn&apos;t require a task list).

One of these must be provided (in order of priority):

- `pgPool` pg.Pool instance
- [`connectionString`](../connection-string.md) setting
- `DATABASE_URL` envvar
- [PostgreSQL environmental variables](https://www.postgresql.org/docs/current/libpq-envars.html),
  including at least `PGDATABASE` (NOTE: not all envvars are supported)

## `Runner`

The `run` method above resolves to a &lsquo;Runner&rsquo; object that has the
following methods and properties:

- `stop(): Promise<void>` &mdash; stops the runner from accepting new jobs, and
  returns a promise that resolves when all the in progress tasks (if any) are
  complete.
- `addJob: AddJobFunction` &mdash; see [`addJob`](/docs/library/add-job).
- `promise: Promise<void>` &mdash; a promise that resolves once the runner has
  completed.
- `events: WorkerEvents` &mdash; a Node.js `EventEmitter` that exposes certain
  events within the runner (see [`WorkerEvents`](/docs/library/worker-events)).

### Example: `runner.addJob()`

See [`addJob`](/docs/library/add-job) for more details.

```js
await runner.addJob("testTask", {
  thisIsThePayload: true,
});
```

### Example: `runner.events`

See [`WorkerEvents`](/docs/library/worker-events) for more details.

```js
runner.events.on("job:success", ({ worker, job }) => {
  console.log(`Hooray! Worker ${worker.workerId} completed job ${job.id}`);
});
```
