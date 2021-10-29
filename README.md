# graphile-worker

[![Patreon sponsor button](https://img.shields.io/badge/sponsor-via%20Patreon-orange.svg)](https://patreon.com/benjie)
[![Discord chat room](https://img.shields.io/discord/489127045289476126.svg)](http://discord.gg/graphile)
[![Package on npm](https://img.shields.io/npm/v/graphile-worker.svg?style=flat)](https://www.npmjs.com/package/graphile-worker)
[![MIT license](https://img.shields.io/npm/l/graphile-worker.svg)](LICENSE.md)
[![Follow](https://img.shields.io/badge/twitter-@GraphileHQ-blue.svg)](https://twitter.com/GraphileHQ)

Job queue for PostgreSQL running on Node.js - allows you to run jobs (e.g.
sending emails, performing calculations, generating PDFs, etc) "in the
background" so that your HTTP response/application code is not held up. Can be
used with any PostgreSQL-backed application. Pairs beautifully with
[PostGraphile](https://www.graphile.org/postgraphile/) or
[PostgREST](http://postgrest.org/).

<!-- SPONSORS_BEGIN -->

## Crowd-funded open-source software

To help us develop this software sustainably under the MIT license, we ask all
individuals and businesses that use it to help support its ongoing maintenance
and development via sponsorship.

### [Click here to find out more about sponsors and sponsorship.](https://www.graphile.org/sponsor/)

And please give some love to our featured sponsors 🤩:

<table><tr>
<td align="center"><a href="https://storyscript.com/?utm_source=postgraphile"><img src="https://graphile.org/images/sponsors/storyscript.png" width="90" height="90" alt="Story.ai" /><br />Story.ai</a> *</td>
<td align="center"><a href="https://surge.io/"><img src="https://graphile.org/images/sponsors/surge.png" width="90" height="90" alt="Surge" /><br />Surge</a> *</td>
<td align="center"><a href="http://chads.website"><img src="https://graphile.org/images/sponsors/chadf.png" width="90" height="90" alt="Chad Furman" /><br />Chad Furman</a> *</td>
<td align="center"><a href="https://postlight.com/?utm_source=graphile"><img src="https://graphile.org/images/sponsors/postlight.jpg" width="90" height="90" alt="Postlight" /><br />Postlight</a> *</td>
<td align="center"><a href="https://openbase.com/"><img src="https://graphile.org/images/sponsors/openbase.png" width="90" height="90" alt="Openbase" /><br />Openbase</a> *</td>
<td align="center"><a href="https://qwick.com/"><img src="https://graphile.org/images/sponsors/qwick.png" width="90" height="90" alt="Qwick" /><br />Qwick</a></td>
</tr></table>

<em>\* Sponsors the entire Graphile suite</em>

<!-- SPONSORS_END -->

## Quickstart: CLI

In your existing Node.js project:

### Add the worker to your project:

```
yarn add graphile-worker
# or: npm install --save graphile-worker
```

### Create tasks:

Create a `tasks/` folder, and place in it JS files containing your task specs.
The names of these files will be the task identifiers, e.g. `hello` below:

```js
// tasks/hello.js
module.exports = async (payload, helpers) => {
  const { name } = payload;
  helpers.logger.info(`Hello, ${name}`);
};
```

### Run the worker

(Make sure you're in the folder that contains the `tasks/` folder.)

```bash
npx graphile-worker -c "my_db"
# or, if you have a remote database, something like:
#   npx graphile-worker -c "postgres://user:pass@host:port/db?ssl=true"
# or, if you prefer envvars
#   DATABASE_URL="..." npx graphile-worker
```

(Note: `npx` runs the local copy of an npm module if it is installed, when
you're ready, switch to using the `package.json` `"scripts"` entry instead.)

### Schedule a job via SQL

Connect to your database and run the following SQL:

```sql
SELECT graphile_worker.add_job('hello', json_build_object('name', 'Bobby Tables'));
```

### Success!

You should see the worker output `Hello, Bobby Tables`. Gosh, that was fast!

## Quickstart: library

Instead of running `graphile-worker` via the CLI, you may use it directly in
your Node.js code. The following is equivalent to the CLI example above:

```js
const { run, quickAddJob } = require("graphile-worker");

async function main() {
  // Run a worker to execute jobs:
  const runner = await run({
    connectionString: "postgres:///my_db",
    concurrency: 5,
    // Install signal handlers for graceful shutdown on SIGINT, SIGTERM, etc
    noHandleSignals: false,
    pollInterval: 1000,
    // you can set the taskList or taskDirectory but not both
    taskList: {
      hello: async (payload, helpers) => {
        const { name } = payload;
        helpers.logger.info(`Hello, ${name}`);
      },
    },
    // or:
    //   taskDirectory: `${__dirname}/tasks`,
  });

  // Or add a job to be executed:
  await quickAddJob(
    // makeWorkerUtils options
    { connectionString: "postgres:///my_db" },

    // Task identifier
    "hello",

    // Payload
    { name: "Bobby Tables" },
  );

  // If the worker exits (whether through fatal error or otherwise), this
  // promise will resolve/reject:
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Running this example should output something like:

```
[core] INFO: Worker connected and looking for jobs... (task names: 'hello')
[job(worker-7327280603017288: hello{1})] INFO: Hello, Bobby Tables
[worker(worker-7327280603017288)] INFO: Completed task 1 (hello) with success (0.16ms)
```

## Support

You can ask for help on Discord at http://discord.gg/graphile

Please support development of this project
[via sponsorship](https://graphile.org/sponsor/). With your support we can
improve performance, usability and documentation at a greater rate, leading to
reduced running and engineering costs for your organisation, leading to a net
ROI.

Professional support contracts are also available; for more information see:
https://graphile.org/support/

## Features

- Standalone and embedded modes
- Designed to be used both from JavaScript or directly in the database
- Easy to test (recommended: `runTaskListOnce` util)
- Low latency (typically under 3ms from task schedule to execution, uses
  `LISTEN`/`NOTIFY` to be informed of jobs as they're inserted)
- High performance (uses `SKIP LOCKED` to find jobs to execute, resulting in
  faster fetches)
- Small tasks (uses explicit task names / payloads resulting in minimal
  serialisation/deserialisation overhead)
- Parallel by default
- Adding jobs to same named queue runs them in series
- Automatically re-attempts failed jobs with exponential back-off
- Customisable retry count (default: 25 attempts over ~3 days)
- Crontab-like scheduling feature for recurring tasks (with optional backfill)
- Task de-duplication via unique `job_key`
- Flexible runtime controls that can be used for complex rate limiting (e.g. via
  [graphile-worker-rate-limiter](https://github.com/politics-rewired/graphile-worker-rate-limiter))
- Open source; liberal MIT license
- Executes tasks written in Node.js (these can call out to any other language or
  networked service)
- Modern JS with 100% async/await API (no callbacks)
- Written natively in TypeScript
- Watch mode for development (experimental - iterate your jobs without
  restarting worker)
- If you're running really lean, you can run Graphile Worker in the same Node
  process as your server to keep costs and devops complexity down.

## Status

Production ready (and used in production).

We're still enhancing/iterating the library rapidly, hence the 0.x numbering;
updating to a new "minor" version (0.y) may require some small code
modifications, particularly to TypeScript type names; these are documented in
the changelog.

This specific codebase is fairly young, but it's based on years of implementing
similar job queues for Postgres.

To give feedback please raise an issue or reach out on discord:
http://discord.gg/graphile

## Requirements

PostgreSQL 10+\* and Node 10+\*.

If your database doesn't already include the `pgcrypto` extension we'll
automatically install it into the public schema for you. If the extension is
installed in a different schema (unlikely) you may face issues. Making alias
functions in the public schema, should solve this issue (see issue
[#43](https://github.com/graphile/worker/issues/43) for an example).

\* Might work with older versions, but has not been tested.

## Installation

```
yarn add graphile-worker
# or: npm install --save graphile-worker
```

## Running

`graphile-worker` manages its own database schema (`graphile_worker`). Just
point graphile-worker at your database and we handle our own migrations:

```
npx graphile-worker -c "postgres:///my_db"
```

(`npx` looks for the `graphile-worker` binary locally; it's often better to use
the `"scripts"` entry in `package.json` instead.)

The following CLI options are available:

```
Options:
      --help                    Show help                              [boolean]
      --version                 Show version number                    [boolean]
  -c, --connection              Database connection string, defaults to the
                                'DATABASE_URL' envvar                   [string]
  -s, --schema                  The database schema in which Graphile Worker is
                                (to be) located
                                           [string] [default: "graphile_worker"]
      --schema-only             Just install (or update) the database schema,
                                then exit             [boolean] [default: false]
      --once                    Run until there are no runnable jobs left, then
                                exit                  [boolean] [default: false]
  -w, --watch                   [EXPERIMENTAL] Watch task files for changes,
                                automatically reloading the task code without
                                restarting worker     [boolean] [default: false]
      --crontab                 override path to crontab file           [string]
  -j, --jobs                    number of jobs to run concurrently
                                                           [number] [default: 1]
  -m, --max-pool-size           maximum size of the PostgreSQL pool
                                                          [number] [default: 10]
      --poll-interval           how long to wait between polling for jobs in
                                milliseconds (for jobs scheduled in the
                                future/retries)         [number] [default: 2000]
      --no-prepared-statements  set this flag if you want to disable prepared
                                statements, e.g. for compatibility with
                                pgBouncer             [boolean] [default: false]
```

## Library usage: running jobs

`graphile-worker` can be used as a library inside your Node.js application.
There are two main use cases for this: running jobs, and queueing jobs. Here are
the APIs for running jobs.

### `run(options: RunnerOptions): Promise<Runner>`

Runs until either stopped by a signal event like `SIGINT` or by calling the
`stop()` method on the resolved object.

The resolved 'Runner' object has a number of helpers on it, see
[Runner object](#runner-object) for more information.

### `runOnce(options: RunnerOptions): Promise<void>`

Equivalent to running the CLI with the `--once` flag. The function will run
until there are no runnable jobs left, and then resolve.

### `runMigrations(options: RunnerOptions): Promise<void>`

Equivalent to running the CLI with the `--schema-only` option. Runs the
migrations and then resolves.

### RunnerOptions

The following options for these methods are available.

- `concurrency`: The equivalent of the CLI `--jobs` option with the same default
  value.
- `noHandleSignals`: If set true, we won't install signal handlers and it'll be
  up to you to handle graceful shutdown of the worker if the process receives a
  signal.
- `pollInterval`: The equivalent of the CLI `--poll-interval` option with the
  same default value.
- `logger`: To change how log messages are output you may provide a custom
  logger; see [`Logger`](#logger) below
- the database is identified through one of these options:
  - `connectionString`: A PostgreSQL connection string to the database
    containing the job queue, or
  - `pgPool`: A `pg.Pool` instance to use
- the tasks to execute are identified through one of these options:
  - `taskDirectory`: A path string to a directory containing the task handlers.
  - `taskList`: An object with the task names as keys and a corresponding task
    handler functions as values
- `schema` can be used to change the default `graphile_worker` schema to
  something else (equivalent to `--schema` on the CLI)
- `forbiddenFlags` see [Forbidden flags](#forbidden-flags) below
- `events`: pass your own `new EventEmitter()` if you want to customize the
  options, get earlier events (before the runner object resolves), or want to
  get events from alternative Graphile Worker entrypoints.
- `noPreparedStatements`: Set true if you want to prevent the use of prepared
  statements, for example if you wish to use Graphile Worker with an external
  PostgreSQL connection pool. Enabling this setting may have a small performance
  impact.

Exactly one of either `taskDirectory` or `taskList` must be provided (except for
`runMigrations` which doesn't require a task list).

One of these must be provided (in order of priority):

- `pgPool` pg.Pool instance
- `connectionString` setting
- `DATABASE_URL` envvar
- [PostgreSQL environmental variables](https://www.postgresql.org/docs/current/libpq-envars.html),
  including at least `PGDATABASE` (NOTE: not all envvars are supported)

### `Runner` object

The `run` method above resolves to a 'Runner' object that has the following
methods and properties:

- `stop(): Promise<void>` - stops the runner from accepting new jobs, and
  returns a promise that resolves when all the in progress tasks (if any) are
  complete.
- `addJob: AddJobFunction` - see [`addJob`](#addjob).
- `promise: Promise<void>` - a promise that resolves once the runner has
  completed.
- `events: WorkerEvents` - a Node.js `EventEmitter` that exposes certain events
  within the runner (see [`WorkerEvents`](#workerevents)).

#### Example: adding a job with `runner.addJob`

See [`addJob`](#addjob) for more details.

```js
await runner.addJob("testTask", {
  thisIsThePayload: true,
});
```

#### Example: listening to an event with `runner.events`

See [`WorkerEvents`](#workerevents) for more details.

```js
runner.events.on("job:success", ({ worker, job }) => {
  console.log(`Hooray! Worker ${worker.workerId} completed job ${job.id}`);
});
```

### `WorkerEvents`

We support a large number of events via an EventEmitter. You can either retrieve
the event emitter via the `events` property on the `Runner` object, or you can
create your own event emitter and pass it to Graphile Worker via the
`WorkerOptions.events` option (this is primarily useful for getting events from
the other Graphile Worker entrypoints).

Details of what events we support and what data is available on the event
payload is detailed below in TypeScript syntax:

```
export type WorkerEvents = TypedEventEmitter<{
  /**
   * When a worker pool is created
   */
  "pool:create": { workerPool: WorkerPool };

  /**
   * When a worker pool attempts to connect to PG ready to issue a LISTEN
   * statement
   */
  "pool:listen:connecting": { workerPool: WorkerPool };

  /**
   * When a worker pool starts listening for jobs via PG LISTEN
   */
  "pool:listen:success": { workerPool: WorkerPool; client: PoolClient };

  /**
   * When a worker pool faces an error on their PG LISTEN client
   */
  "pool:listen:error": {
    workerPool: WorkerPool;
    error: any;
    client: PoolClient;
  };

  /**
   * When a worker pool is released
   */
  "pool:release": { pool: WorkerPool };

  /**
   * When a worker pool starts a graceful shutdown
   */
  "pool:gracefulShutdown": { pool: WorkerPool; message: string };

  /**
   * When a worker pool graceful shutdown throws an error
   */
  "pool:gracefulShutdown:error": { pool: WorkerPool; error: any };

  /**
   * When a worker is created
   */
  "worker:create": { worker: Worker; tasks: TaskList };

  /**
   * When a worker release is requested
   */
  "worker:release": { worker: Worker };

  /**
   * When a worker stops (normally after a release)
   */
  "worker:stop": { worker: Worker; error?: any };

  /**
   * When a worker is about to ask the database for a job to execute
   */
  "worker:getJob:start": { worker: Worker };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:error": { worker: Worker; error: any };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:empty": { worker: Worker };

  /**
   * When a worker is created
   */
  "worker:fatalError": { worker: Worker; error: any; jobError: any | null };

  /**
   * When a job is retrieved by get_job
   */
  "job:start": { worker: Worker; job: Job };

  /**
   * When a job completes successfully
   */
  "job:success": { worker: Worker; job: Job };

  /**
   * When a job throws an error
   */
  "job:error": { worker: Worker; job: Job; error: any };

  /**
   * When a job fails permanently (emitted after job:error when appropriate)
   */
  "job:failed": { worker: Worker; job: Job; error: any };

  /**
   * When a job has finished executing and the result (success or failure) has
   * been written back to the database
   */
  "job:complete": { worker: Worker; job: Job; error: any  };

  /**
   * When the runner is terminated by a signal
   */
  gracefulShutdown: { signal: Signal };

  /**
   * When the runner is stopped
   */
  stop: {};
}>;
```

## Library usage: queueing jobs

You can also use the `graphile-worker` library to queue jobs using one of the
following APIs.

NOTE: although running the worker will automatically install its schema, the
same is not true for queuing jobs. You must ensure that the worker database
schema is installed before you attempt to enqueue a job; you can install the
database schema into your database with the following command:

```
yarn graphile-worker -c "postgres:///my_db" --schema-only
```

Alternatively you can use the `WorkerUtils` migrate method:

```
await workerUtils.migrate();
```

### `makeWorkerUtils(options: WorkerUtilsOptions): Promise<WorkerUtils>`

Useful for adding jobs from within JavaScript in an efficient way.

Runnable example:

```js
const { makeWorkerUtils } = require("graphile-worker");

async function main() {
  const workerUtils = await makeWorkerUtils({
    connectionString: "postgres:///my_db",
  });
  try {
    await workerUtils.migrate();

    await workerUtils.addJob(
      // Task identifier
      "calculate-life-meaning",

      // Payload
      { value: 42 },

      // Optionally, add further task spec details here
    );

    // await workerUtils.addJob(...);
    // await workerUtils.addJob(...);
    // await workerUtils.addJob(...);
  } finally {
    await workerUtils.release();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

We recommend building one instance of WorkerUtils and sharing it as a singleton
throughout your code.

### WorkerUtilsOptions

- exactly one of these keys must be present to determine how to connect to the
  database:
  - `connectionString`: A PostgreSQL connection string to the database
    containing the job queue, or
  - `pgPool`: A `pg.Pool` instance to use
- `schema` can be used to change the default `graphile_worker` schema to
  something else (equivalent to `--schema` on the CLI)

### WorkerUtils

A `WorkerUtils` instance has the following methods:

- `addJob(name: string, payload: JSON, spec: TaskSpec)` - a method you can call
  to enqueue a job, see [addJob](#addjob).
- `migrate()` - a method you can call to update the graphile-worker database
  schema; returns a promise.
- `release()` - call this to release the `WorkerUtils` instance. It's typically
  best to use `WorkerUtils` as a singleton, so you often won't need this, but
  it's useful for tests or processes where you want Node to exit cleanly when
  it's done.

### `quickAddJob(options: WorkerUtilsOptions, ...addJobArgs): Promise<Job>`

If you want to quickly add a job and you don't mind the cost of opening a DB
connection pool and then cleaning it up right away _for every job added_,
there's the `quickAddJob` convenience function. It takes the same options as
`makeWorkerUtils` as the first argument; the remaining arguments are for
[`addJob`](#addjob).

NOTE: you are recommended to use `makeWorkerUtils` instead where possible, but
in one-off scripts this convenience method may be enough.

Runnable example:

```js
const { quickAddJob } = require("graphile-worker");

async function main() {
  await quickAddJob(
    // makeWorkerUtils options
    { connectionString: "postgres:///my_db" },

    // Task identifier
    "calculate-life-meaning",

    // Payload
    { value: 42 },

    // Optionally, add further task spec details here
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## addJob

The `addJob` API exists in many places in graphile-worker, but all the instances
have exactly the same call signature. The API is used to add a job to the queue
for immediate or delayed execution. With `jobKey` and `jobKeyMode` it can also
be used to replace existing jobs.

NOTE: `quickAddJob` is similar to `addJob`, but accepts an additional initial
parameter describing how to connect to the database).

The `addJob` arguments are as follows:

- `identifier`: the name of the task to be executed
- `payload`: an optional JSON-compatible object to give the task more context on
  what it is doing
- `options`: an optional object specifying:
  - `queueName`: the queue to run this task under
  - `runAt`: a Date to schedule this task to run in the future
  - `maxAttempts`: how many retries should this task get? (Default: 25)
  - `jobKey`: unique identifier for the job, used to replace, update or remove
    it later if needed (see
    [Replacing, updating and removing jobs](#replacing-updating-and-removing-jobs));
    can be used for de-duplication (i.e. throttling or debouncing)
  - `jobKeyMode`: controls the behavior of `jobKey` when a matching job is found
    (see
    [Replacing, updating and removing jobs](#replacing-updating-and-removing-jobs))

Example:

```js
await addJob("task_2", { foo: "bar" });
```

Definitions:

```ts
export type AddJobFunction = (
  /**
   * The name of the task that will be executed for this job.
   */
  identifier: string,

  /**
   * The payload (typically a JSON object) that will be passed to the task executor.
   */
  payload?: any,

  /**
   * Additional details about how the job should be handled.
   */
  spec?: TaskSpec,
) => Promise<Job>;

export interface TaskSpec {
  /**
   * The queue to run this task under (only specify if you want jobs in this
   * queue to run serially). (Default: null)
   */
  queueName?: string;

  /**
   * A Date to schedule this task to run in the future. (Default: now)
   */
  runAt?: Date;

  /**
   * Jobs are executed in numerically ascending order of priority (jobs with a
   * numerically smaller priority are run first). (Default: 0)
   */
  priority?: number;

  /**
   * How many retries should this task get? (Default: 25)
   */
  maxAttempts?: number;

  /**
   * Unique identifier for the job, can be used to update or remove it later if
   * needed. (Default: null)
   */
  jobKey?: string;

  /**
   * Modifies the behavior of `jobKey`; when 'replace' all attributes will be
   * updated, when 'preserve_run_at' all attributes except 'run_at' will be
   * updated, when 'unsafe_dedupe' a new job will only be added if no existing
   * job (including locked jobs and permanently failed jobs) with matching job
   * key exists. (Default: 'replace')
   */
  jobKeyMode?: "replace" | "preserve_run_at" | "unsafe_dedupe";

  /**
   * Flags for the job, can be used to dynamically filter which jobs can and
   * cannot run at runtime. (Default: null)
   */
  flags?: string[];
}
```

## Logger

We use [`@graphile/logger`](https://github.com/graphile/logger) as a log
abstraction so that you can log to whatever logging facilities you like. By
default this will log to `console`, and debug-level messages are not output
unless you have the environmental variable `GRAPHILE_LOGGER_DEBUG=1`. You can
override this by passing a custom `logger`.

It's recommended that your tasks always use the methods on `helpers.logger` for
logging so that you can later route your messages to a different log store if
you want to. There are 4 methods, one for each level of severity (`error`,
`warn`, `info`, `debug`), and each accept a string as the first argument and
optionally an arbitrary object as the second argument:

- `helpers.logger.error(message: string, meta?: LogMeta)`
- `helpers.logger.warn(message: string, meta?: LogMeta)`
- `helpers.logger.info(message: string, meta?: LogMeta)`
- `helpers.logger.debug(message: string, meta?: LogMeta)`

You may customise where log messages from `graphile-worker` (and your tasks) go
by supplying a custom `Logger` instance using your own `logFactory`.

```js
const { Logger, run } = require("graphile-worker");

/* Replace this function with your own implementation */
function logFactory(scope) {
  return (level, message, meta) => {
    console.log(level, message, scope, meta);
  };
}

const logger = new Logger(logFactory);

// Pass the logger to the 'run' method as part of options:
run({
  logger,
  /* pgPool, taskList, etc... */
});
```

Your `logFactory` function will be passed a scope object which may contain the
following keys (all optional):

- `label` (string): a rough description of the type of action ('watch', 'worker'
  and 'job' are the currently used values).
- `workerId` (string): the ID of the worker instance
- `taskIdentifier` (string): the task name (identifier) of the running job
- `jobId` (number): the id of the running job

And it should return a logger function which will receive these three arguments:

- `level` ('error', 'warning', 'info' or 'debug') - severity of the log message
- `message` (string) - the log message itself
- `meta` (optional object) - may contain other useful metadata, useful in
  structured logging systems

The return result of the logger function is currently ignored; but we strongly
recommend that for future compatibility you do not return anything from your
logger function.

See the [`@graphile/logger`](https://github.com/graphile/logger) documentation
for more information.

**NOTE**: you do not need to (and should not) customise, inherit or extend the
`Logger` class at all.

## Creating task executors

A task executor is a simple async JS function which receives as input the job
payload and a collection of helpers. It does the work and then returns. If it
returns then the job is deemed a success and is deleted from the queue. If it
throws an error then the job is deemed a failure and the task is rescheduled
using an exponential-backoff algorithm.

**IMPORTANT**: your jobs should wait for all asynchronous work to be completed
before returning, otherwise we might mistakenly think they were successful.

**IMPORTANT**: we automatically retry the job if it fails, so it's often
sensible to split large jobs into smaller jobs, this also allows them to run in
parallel resulting in faster execution. This is particularly important for tasks
that are not idempotent (i.e. running them a second time will have extra side
effects) - for example sending emails.

Tasks are created in the `tasks` folder in the directory from which you run
`graphile-worker`; the name of the file (less the `.js` suffix) is used as the
task identifier. Currently only `.js` files that can be directly loaded by
Node.js are supported; if you are using Babel, TypeScript or similar you will
need to compile your tasks into the `tasks` folder.

```
current directory
├── package.json
├── node_modules
└── tasks
    ├── task_1.js
    └── task_2.js
```

```js
// tasks/task_1.js
module.exports = async (payload) => {
  await doMyLogicWith(payload);
};
```

```js
// tasks/task_2.js
module.exports = async (payload, helpers) => {
  // async is optional, but best practice
  helpers.logger.debug(`Received ${JSON.stringify(payload)}`);
};
```

Each task function is passed two arguments:

- `payload` - the payload you passed when calling `add_job`
- `helpers` - an object containing:
  - `logger` - a scoped Logger instance, to aid tracing/debugging
  - `job` - the whole job (including `uuid`, `attempts`, etc) - you shouldn't
    need this
  - `withPgClient` - a helper to use to get a database client
  - `query(sql, values)` - a convenience wrapper for
    `withPgClient(pgClient => pgClient.query(sql, values))`
  - `addJob` - a helper to schedule a job

### helpers

#### `helpers.logger`

So that you may redirect logs to your preferred logging provider, we have
enabled you to supply your own logging provider. Overriding this is currently
only available in library mode (see [Logger](#logger)). We then wrap this
logging provider with a helper class to ease debugging; the helper class has the
following methods:

- `error(message, meta?)`: for logging errors, similar to `console.error`
- `warn(message, meta?)`: for logging warnings, similar to `console.warn`
- `info(message, meta?)`: for logging informational messages, similar to
  `console.info`
- `debug(message, meta?)`: to aid with debugging, similar to `console.log`
- `scope(additionalScope)`: returns a new `Logger` instance with additional
  scope information

#### `helpers.withPgClient(callback)`

`withPgClient` gets a `pgClient` from the pool, calls
`await callback(pgClient)`, and finally releases the client and returns the
result of `callback`. This workflow makes testing your tasks easier.

Example:

```js
const {
  rows: [row],
} = await withPgClient((pgClient) => pgClient.query("select 1 as one"));
```

#### `helpers.addJob(identifier, payload?, options?)`

See [`addJob`](#addjob)

## More detail on scheduling jobs through SQL

You can schedule jobs directly in the database, e.g. from a trigger or function,
or by calling SQL from your application code. You do this using the
`graphile_worker.add_job` function.

NOTE: the [`addJob`](#addjob) JavaScript method simply defers to this underlying
`add_job` SQL function.

`add_job` accepts the following parameters (in this order):

- `identifier` - the only **required** field, indicates the name of the task
  executor to run (omit the `.js` suffix!)
- `payload` - a JSON object with information to tell the task executor what to
  do (defaults to an empty object)
- `queue_name` - if you want certain tasks to run one at a time, add them to the
  same named queue (defaults to `null`)
- `run_at` - a timestamp after which to run the job; defaults to now.
- `max_attempts` - if this task fails, how many times should we retry it?
  Default: 25.
- `job_key` - unique identifier for the job, used to replace, update or remove
  it later if needed (see
  [Replacing, updating and removing jobs](#replacing-updating-and-removing-jobs));
  can also be used for de-duplication
- `priority` - an integer representing the jobs priority. Jobs are executed in
  numerically ascending order of priority (jobs with a numerically smaller
  priority are run first).
- `flags` - an optional text array (`text[]`) representing a flags to attach to
  the job. Can be used alongside the `forbiddenFlags` option in library mode to
  implement complex rate limiting or other behaviors which requiring skipping
  jobs at runtime (see [Forbidden flags](#forbidden-flags)).
- `job_key_mode` - when `job_key` is specified, this setting indicates what
  should happen when an existing job is found with the same job key:
  - `replace` (default) - all job parameters are updated to the new values,
    including the `run_at` (inserts new job if matching job is locked)
  - `preserve_run_at` - all job parameters are updated to the new values, except
    for `run_at` which maintains the previous value (inserts new job if matching
    job is locked)
  - `unsafe_dedupe` - only inserts the job if no existing job (whether or not it
    is locked or has failed permanently) with matching key is found; does not
    update the existing job

Typically you'll want to set the `identifier` and `payload`:

```sql
SELECT graphile_worker.add_job(
  'send_email',
  json_build_object(
    'to', 'someone@example.com',
    'subject', 'graphile-worker test'
  )
);
```

It's recommended that you use
[PostgreSQL's named parameters](https://www.postgresql.org/docs/current/sql-syntax-calling-funcs.html#SQL-SYNTAX-CALLING-FUNCS-NAMED)
for the other parameters so that you only need specify the arguments you're
using:

```sql
SELECT graphile_worker.add_job('reminder', run_at := NOW() + INTERVAL '2 days');
```

**TIP**: if you want to run a job after a variable number of seconds according
to the database time (rather than the application time), you can use interval
multiplication; see `run_at` in this example:

```sql
SELECT graphile_worker.add_job(
  $1,
  payload := $2,
  queue_name := $3,
  max_attempts := $4,
  run_at := NOW() + ($5 * INTERVAL '1 second')
);
```

**NOTE:** `graphile_worker.add_job(...)` requires database owner privileges to
execute. To allow lower-privileged users to call it, wrap it inside a PostgreSQL
function marked as `SECURITY DEFINER` so that it will run with the same
privileges as the more powerful user that defined it. (Be sure that this
function performs any access checks that are necessary.)

### Example: scheduling job from trigger

This snippet creates a trigger function which adds a job to execute
`task_identifier_here` when a new row is inserted into `my_table`.

```sql
CREATE FUNCTION my_table_created() RETURNS trigger AS $$
BEGIN
  PERFORM graphile_worker.add_job('task_identifier_here', json_build_object('id', NEW.id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trigger_name AFTER INSERT ON my_table FOR EACH ROW EXECUTE PROCEDURE my_table_created();
```

### Example: one trigger function to rule them all

If your tables are all defined with a single primary key named `id` then you can
define a more convenient dynamic trigger function which can be called from
multiple triggers for multiple tables to quickly schedule jobs.

```sql
CREATE FUNCTION trigger_job() RETURNS trigger AS $$
BEGIN
  PERFORM graphile_worker.add_job(TG_ARGV[0], json_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
```

You might use this trigger like this:

```sql
CREATE TRIGGER send_verification_email
  AFTER INSERT ON user_emails
  FOR EACH ROW
  WHEN (NEW.verified is false)
  EXECUTE PROCEDURE trigger_job('send_verification_email');
CREATE TRIGGER user_changed
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_job('user_changed');
CREATE TRIGGER generate_pdf
  AFTER INSERT ON pdfs
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_job('generate_pdf');
CREATE TRIGGER generate_pdf_update
  AFTER UPDATE ON pdfs
  FOR EACH ROW
  WHEN (NEW.title IS DISTINCT FROM OLD.title)
  EXECUTE PROCEDURE trigger_job('generate_pdf');
```

## Replacing, updating and removing jobs

### Replacing/updating jobs

Jobs scheduled with a `job_key` parameter may be replaced/updated by calling
`add_job` again with the same `job_key` value. This can be used for rescheduling
jobs, to ensure only one of a given job is scheduled at a time, or to update
other settings for the job.

For example after the below SQL transaction, the `send_email` job will run only
once, with the payload `'{"count": 2}'`:

```sql
BEGIN;
SELECT graphile_worker.add_job('send_email', '{"count": 1}', job_key := 'abc');
SELECT graphile_worker.add_job('send_email', '{"count": 2}', job_key := 'abc');
COMMIT;
```

In all cases if no match is found then a new job will be created; behavior when
an existing job with the same job key is found is controlled by the
`job_key_mode` setting:

- `replace` (default) - overwrites the unlocked job with the new values. This is
  primarily useful for rescheduling, updating, or **debouncing** (delaying
  execution until there have been no events for at least a certain time period).
  Locked jobs will cause a new job to be scheduled instead.
- `preserve_run_at` - overwrites the unlocked job with the new values, but
  preserves `run_at`. This is primarily useful for **throttling** (executing at
  most once over a given time period). Locked jobs will cause a new job to be
  scheduled instead.
- `unsafe_dedupe` - if an existing job is found, even if it is locked or
  permanently failed, then it won't be updated. This is very dangerous as it
  means that the event that triggered this `add_job` call may not result in any
  action. It is strongly advised you do not use this mode unless you are certain
  you know what you are doing.

The full `job_key_mode` algorithm is roughly as follows:

- If no existing job with the same job key is found:
  - a new job will be created with the new attributes.
- Otherwise, if `job_key_mode` is `unsafe_dedupe`:
  - stop and return the existing job.
- Otherwise, if the existing job is locked:
  - it will have its `key` cleared
  - it will have its attempts set to `max_attempts` to avoid it running again
  - a new job will be created with the new attributes.
- Otherwise, if the existing job has previously failed:
  - it will have its `attempts` reset to 0 (as if it were newly scheduled)
  - it will have its `last_error` cleared
  - it will have all other attributes updated to their new values, including
    `run_at` (even when `job_key_mode` is `preserve_run_at`).
- Otherwise, if `job_key_mode` is `preserve_run_at`:
  - the job will have all its attributes except for `run_at` updated to their
    new values.
- Otherwise:
  - the job will have all its attributes updated to their new values.

### Removing jobs

Pending jobs may also be removed using `job_key`:

```sql
SELECT graphile_worker.remove_job('abc');
```

### `job_key` caveats

**IMPORTANT**: jobs that complete successfully are deleted, there is no
permanent `job_key` log, i.e. `remove_job` on a completed `job_key` is a no-op
as no row exists.

**IMPORTANT**: the `job_key` is treated as universally unique (whilst the job is
pending/failed), so you can update a job to have a completely different
`task_identifier` or `payload`. You must be careful to ensure that your
`job_key` is sufficiently unique to prevent you accidentally replacing or
deleting unrelated jobs by mistake; one way to approach this is to incorporate
the `task_identifier` into the `job_key`.

**IMPORTANT**: If a job is updated using `add_job` when it is currently locked
(i.e. running), a second job will be scheduled separately (unless
`job_key_mode = 'unsafe_dedupe'`), meaning both will run.

**IMPORTANT**: calling `remove_job` for a locked (i.e. running) job will not
actually remove it, but will prevent it from running again on failure.

## Administration functions

When implementing an administrative UI you may need more control over the jobs.
For this we have added a few administrative functions that can be called in SQL
or through the JS API. The JS API is exposed via a `WorkerUtils` instance; see
`makeWorkerUtils` above.

**IMPORTANT**: if you choose to run `UPDATE` or `DELETE` commands against the
underlying tables, be sure to _NOT_ manipulate jobs that are locked as this
could have unintended consequences. The following administrative functions will
automatically ensure that the jobs are not locked before applying any changes.

### Complete jobs

SQL: `SELECT * FROM graphile_worker.complete_jobs(ARRAY[7, 99, 38674, ...])`;

JS: `const deletedJobs = await workerUtils.completeJobs([7, 99, 38674, ...]);`

Marks the specified jobs (by their ids) as if they were completed, assuming they
are not locked. Note that completing a job deletes it. You may mark failed and
permanently failed jobs as completed if you wish. The deleted jobs will be
returned (note that this may be fewer jobs than you requested).

### Permanently fail jobs

SQL:
`SELECT * FROM graphile_worker.permanently_fail_jobs(ARRAY[7, 99, 38674, ...], 'Enter reason here')`;

JS:
`const updatedJobs = await workerUtils.permanentlyFailJobs([7, 99, 38674, ...], 'Enter reason here');`

Marks the specified jobs (by their ids) as failed permanently, assuming they are
not locked. This means setting their `attempts` equal to their `max_attempts`.
The updated jobs will be returned (note that this may be fewer jobs than you
requested).

### Rescheduling jobs

SQL:

```sql
SELECT * FROM graphile_worker.reschedule_jobs(
  ARRAY[7, 99, 38674, ...],
  run_at := NOW() + interval '5 minutes',
  priority := 5,
  attempts := 5,
  max_attempts := 25
);
```

JS:

```js
const updatedJobs = await workerUtils.rescheduleJobs(
  [7, 99, 38674, ...],
  {
    runAt: '2020-02-02T02:02:02Z',
    priority: 5,
    attempts: 5,
    maxAttempts: 25
  }
);
```

Updates the specified scheduling properties of the jobs (assuming they are not
locked). All of the specified options are optional, omitted or null values will
left unmodified.

This method can be used to postpone or advance job execution, or to schedule a
previously failed or permanently failed job for execution. The updated jobs will
be returned (note that this may be fewer jobs than you requested).

## Recurring tasks (crontab)

**Stability: _experimental_**; we may make breaking changes to this
functionality in a minor release, so pay close attention to the changelog when
upgrading.

Graphile Worker supports triggering recurring tasks according to a cron-like
schedule. This is designed for recurring tasks such as sending a weekly email,
running database maintenance tasks every day, performing data roll-ups hourly,
downloading external data every 20 minutes, etc.

Graphile Worker's crontab support:

- guarantees (thanks to ACID-compliant transactions) that no duplicate task
  schedules will occur
- can backfill missed jobs if desired (e.g. if the Worker wasn't running when
  the job was due to be scheduled)
- schedules tasks using Graphile Worker's regular job queue, so you get all the
  regular features such as exponential back-off on failure.
- works reliably even if you're running multiple workers (see "Distributed
  crontab" below)

**NOTE**: It is not intended that you add recurring tasks for each of your
individual application users, instead you should have relatively few recurring
tasks, and those tasks can create additional jobs for the individual users (or
process multiple users) if necessary.

Tasks are by default read from a `crontab` file next to the `tasks/` folder (but
this is configurable in library mode). Please note that our syntax is not 100%
compatible with cron's, and our task payload differs. We only handle timestamps
in UTC. The following diagram details the parts of a Graphile Worker crontab
schedule:

```crontab
# ┌───────────── UTC minute (0 - 59)
# │ ┌───────────── UTC hour (0 - 23)
# │ │ ┌───────────── UTC day of the month (1 - 31)
# │ │ │ ┌───────────── UTC month (1 - 12)
# │ │ │ │ ┌───────────── UTC day of the week (0 - 6) (Sunday to Saturday)
# │ │ │ │ │ ┌───────────── task (identifier) to schedule
# │ │ │ │ │ │    ┌────────── optional scheduling options
# │ │ │ │ │ │    │     ┌────── optional payload to merge
# │ │ │ │ │ │    │     │
# │ │ │ │ │ │    │     │
# * * * * * task ?opts {payload}
```

Comment lines start with a `#`.

For the first 5 fields we support an explicit numeric value, `*` to represent
all valid values, `*/n` (where `n` is a positive integer) to represent all valid
values divisible by `n`, range syntax such as `1-5`, and any combination of
these separated by commas.

The task identifier should match the following regexp
`/^[_a-zA-Z][_a-zA-Z0-9:_-]*$/` (namely it should start with an alphabetic
character and it should only contain alphanumeric characters, colon, underscore
and hyphen). It should be the name of one of your Graphile Worker tasks.

The `opts` must always be prefixed with a `?` if provided and details
configuration for the task such as what should be done in the event that the
previous event was not scheduled (e.g. because the Worker wasn't running).
Options are specified using HTTP query string syntax (with `&` separator).

Currently we support the following `opts`:

- `id=UID` where UID is a unique alphanumeric case-sensitive identifier starting
  with a letter - specify an identifier for this crontab entry; by default this
  will use the task identifier, but if you want more than one schedule for the
  same task (e.g. with different payload, or different times) then you will need
  to supply a unique identifier explicitly.
- `fill=t` where `t` is a "time phrase" (see below) - backfill any entries from
  the last time period `t`, for example if the worker was not running when they
  were due to be executed (by default, no backfilling).
- `max=n` where `n` is a small positive integer - override the `max_attempts` of
  the job.
- `queue=name` where `name` is an alphanumeric queue name - add the job to a
  named queue so it executes serially.
- `priority=n` where `n` is a relatively small integer - override the priority
  of the job.

**NOTE**: changing the identifier (e.g. via `id`) can result in duplicate
executions, so we recommend that you explicitly set it and never change it.

**NOTE**: using `fill` will not backfill new tasks, only tasks that were
previously known.

**NOTE**: the higher you set the `fill` parameter, the longer the worker startup
time will be; when used you should set it to be slightly larger than the longest
period of downtime you expect for your worker.

Time phrases are comprised of a sequence of number-letter combinations, where
the number represents a quantity and the letter represents a time period, e.g.
`5d` for `five days`, or `3h` for `three hours`; e.g. `4w3d2h1m` represents
`4 weeks, 3 days, 2 hours and 1 minute` (i.e. a period of 44761 minutes). The
following time periods are supported:

- `s` - one second (1000 milliseconds)
- `m` - one minute (60 seconds)
- `h` - one hour (60 minutes)
- `d` - one day (24 hours)
- `w` - one week (7 days)

The `payload` is a JSON5 object; it must start with a `{`, must not contain
newlines or carriage returns (`\n` or `\r`), and must not contain trailing
whitespace. It will be merged into the default crontab payload properties.

Each crontab job will have a JSON object payload containing the key `_cron` with
the value being an object with the following entries:

- `ts` - ISO8601 timestamp representing when this job was due to execute
- `backfilled` - true if the task was "backfilled" (i.e. it wasn't scheduled on
  time), false otherwise

### Distributed crontab

**TL;DR**: when running identical crontabs on multiple workers no special action
is necessary - it Just Works :tm:

When you run multiple workers with the same crontab files then the first worker
that attempts to queue a particular cron job will succeed and the other workers
will take no action - this is thanks to SQL ACID-compliant transactions and our
`known_crontabs` lock table.

If your workers have different crontabs then you must be careful to ensure that
the cron items each have unique identifiers; the easiest way to do this is to
specify the identifiers yourself (see the `id=` option above). Should you forget
to do this then for any overlapping timestamps for items that have the same
derived identifier one of the cron tasks will schedule but the others will not.

### Crontab examples

The following schedules the `send_weekly_email` task at 4:30am (UTC) every
Monday:

```
30 4 * * 1 send_weekly_email
```

The following does similar, but also will backfill any tasks over the last two
days (`2d`), sets max attempts to `10` and merges in `{"onboarding": false}`
into the task payload:

```
30 4 * * 1 send_weekly_email ?fill=2d&max=10 {onboarding:false}
```

The following triggers the `rollup` task every 4 hours on the hour:

```
0 */4 * * * rollup
```

### Limiting backfill

When you ask Graphile Worker to backfill jobs, it will do so for all jobs
matching that specification that should have been scheduled over the backfill
period. Other than the period itself, you cannot place limits on the backfilling
(for example, you cannot say "backfill at most one job" or "only backfill if the
next job isn't due within the next 3 hours"); this is because we've determined
that there's many situations (back-off, overloaded worker, serially executed
jobs, etc.) in which the result of this behaviour might result in outcomes that
the user did not expect.

If you need these kinds of constraints on backfilled jobs, you should implement
them _at runtime_ (rather than at scheduling time) in the task executor itself,
which could use the `payload._cron.ts` property to determine whether execution
should continue or not.

### Specifying cron items in library mode

You've three options for specifying cron tasks in library mode:

1. `crontab`: a crontab string (like the contents of a crontab file)
2. `crontabFile`: the (string) path to a crontab file, from which to read the
   rules
3. `parsedCronItems`: explicit parsed cron items (see below)

#### parsedCronItems

The Graphile Worker internal format for cron items lists all the matching
minutes/hours/etc uniquely and in numerically ascending order. It also has other
requirements and is to be treated as an opaque type, so you must not construct
this value manually.

Instead, you may specify the parsedCronItems using one of the helper functions:

1. `parseCrontab`: pass a crontab string and it will be converted into a list of
   `ParsedCronItem`s
2. `parseCronItems`: pass a list of `CronItem`s and it will be converted into a
   list of `ParsedCronItem`s

The `CronItem` type is designed to be written by humans (and their scripts) and
has the following properties:

- `task` (required): the string identifier of the task that should be executed
  (same as the first argument to `add_job`)
- `pattern` (required): a cron pattern (e.g. `* * * * *`) describing when to run
  this task
- `options`: optional options influencing backfilling, etc
  - `backfillPeriod`: how long (in milliseconds) to backfill (see above)
  - `maxAttempts`: the maximum number of attempts we'll give the job
  - `queueName`: if you want the job to run serially, you can add it to a named
    queue
  - `priority`: optionally override the priority of the job
- `payload`: an optional payload object to merge into the generated payload for
  the job
- `identifier`: an optional string to give this cron item a permanent
  identifier; if not given we will use the `task`. This is particularly useful
  if you want to schedule the same task multiple times, perhaps on different
  time patterns or with different payloads or other options (since every cron
  item must have a unique identifier).

## Forbidden flags

When a job is created (or updated via `job_key`), you may set its `flags` to a
list of strings. When the worker is run in library mode, you may pass the
`forbiddenFlags` option to indicate that jobs with any of the given flags should
not be executed.

```js
await run({
  // ...
  forbiddenFlags: forbiddenFlags,
});
```

The `forbiddenFlags` option can be:

- null
- an array of strings
- a function returning null or an array of strings
- an (async) function returning a promise that resolve to null or an array of
  strings

If `forbiddenFlags` is a function, `graphile-worker` will invoke it each time a
worker looks for a job to run, and will skip over any job that has any flag
returned by your function. You should ensure that `forbiddenFlags` resolves
quickly; it's advised that you maintain a cache you update periodically (e.g.
once a second) rather than always calculating on the fly, or use pub/sub or a
similar technique to maintain the forbidden flags list.

For an example of how this can be used to achieve rate-limiting logic, see the
[graphile-worker-rate-limiter project](https://github.com/politics-rewired/graphile-worker-rate-limiter)
and the discussion on
[issue #118](https://github.com/graphile/worker/issues/118).

## Rationality checks

We recommend that you limit `queue_name`, `task_identifier` and `job_key` to
printable ASCII characters.

- `queue_name` can be at most 128 characters long
- `task_identifier` can be at most 128 characters long
- `job_key` can be at most 512 characters long
- `schema` should be reasonable; max 32 characters is preferred. Defaults to
  `graphile_worker` (15 chars)

## Uninstallation

To delete the worker code and all the tasks from your database, just run this
one SQL statement:

```sql
DROP SCHEMA graphile_worker CASCADE;
```

## Performance

`graphile-worker` is not intended to replace extremely high performance
dedicated job queues, it's intended to be a very easy way to get a reasonably
performant job queue up and running with Node.js and PostgreSQL. But this
doesn't mean it's a slouch by any means - it achieves an average latency from
triggering a job in one process to executing it in another of under 3ms, and a
12-core database server can process around 10,000 jobs per second.

`graphile-worker` is horizontally scalable. Each instance has a customisable
worker pool, this pool defaults to size 1 (only one job at a time on this
worker) but depending on the nature of your tasks (i.e. assuming they're not
compute-heavy) you will likely want to set this higher to benefit from Node.js'
concurrency. If your tasks are compute heavy you may still wish to set it higher
and then using Node's `child_process` (or Node v11's `worker_threads`) to share
the compute load over multiple cores without significantly impacting the main
worker's runloop.

To test performance, you can run `yarn perfTest`. This runs three tests:

1. a startup/shutdown test to see how fast the worker can startup and exit if
   there's no jobs queued (this includes connecting to the database and ensuring
   the migrations are up to date)
2. a load test - by default this will run 20,000
   [trivial](perfTest/tasks/log_if_999.js) jobs with a parallelism of 4 (i.e. 4
   node processes) and a concurrency of 10 (i.e. 10 concurrent jobs running on
   each node process), but you can configure this in `perfTest/run.js`. (These
   settings were optimised for a 12-core hyperthreading machine.)
3. a latency test - determining how long between issuing an `add_job` command
   and the task itself being executed.

### perfTest results:

The test was ran on a 12-core AMD Ryzen 3900 with an M.2 SSD, running both the
workers and the database (and a tonne of Chrome tabs, electron apps, and what
not). Jobs=20000, parallelism=4, concurrency=10.

Conclusion:

- Startup/shutdown: 66ms
- Jobs per second: 10,299
- Average latency: 2.62ms (min: 2.43ms, max: 11.90ms)

```
Timing startup/shutdown time...
... it took 66ms

Scheduling 20000 jobs


Timing 20000 job execution...
Found 999!

... it took 2008ms
Jobs per second: 10298.81


Testing latency...
[core] INFO: Worker connected and looking for jobs... (task names: 'latency')
Beginning latency test
Latencies - min: 2.43ms, max: 11.90ms, avg: 2.62ms
```

TODO: post perfTest results in a more reasonable configuration, e.g. using an
RDS PostgreSQL server and a worker running on EC2.

## Exponential-backoff

We currently use the formula `exp(least(10, attempt))` to determine the delays
between attempts (the job must fail before the next attempt is scheduled, so the
total time elapsed may be greater depending on how long the job runs for before
it fails). This seems to handle temporary issues well, after ~4 hours attempts
will be made every ~6 hours until the maximum number of attempts is achieved.
The specific delays can be seen below:

```
select
  attempt,
  exp(least(10, attempt)) * interval '1 second' as delay,
  sum(exp(least(10, attempt)) * interval '1 second') over (order by attempt asc) total_delay
from generate_series(1, 24) as attempt;

 attempt |      delay      |   total_delay
---------+-----------------+-----------------
       1 | 00:00:02.718282 | 00:00:02.718282
       2 | 00:00:07.389056 | 00:00:10.107338
       3 | 00:00:20.085537 | 00:00:30.192875
       4 | 00:00:54.598150 | 00:01:24.791025
       5 | 00:02:28.413159 | 00:03:53.204184
       6 | 00:06:43.428793 | 00:10:36.632977
       7 | 00:18:16.633158 | 00:28:53.266135
       8 | 00:49:40.957987 | 01:18:34.224122
       9 | 02:15:03.083928 | 03:33:37.308050
      10 | 06:07:06.465795 | 09:40:43.773845
      11 | 06:07:06.465795 | 15:47:50.239640
      12 | 06:07:06.465795 | 21:54:56.705435
      13 | 06:07:06.465795 | 28:02:03.171230
      14 | 06:07:06.465795 | 34:09:09.637025
      15 | 06:07:06.465795 | 40:16:16.102820
      16 | 06:07:06.465795 | 46:23:22.568615
      17 | 06:07:06.465795 | 52:30:29.034410
      18 | 06:07:06.465795 | 58:37:35.500205
      19 | 06:07:06.465795 | 64:44:41.966000
      20 | 06:07:06.465795 | 70:51:48.431795
      21 | 06:07:06.465795 | 76:58:54.897590
      22 | 06:07:06.465795 | 83:06:01.363385
      23 | 06:07:06.465795 | 89:13:07.829180
      24 | 06:07:06.465795 | 95:20:14.294975
```

## What if something goes wrong?

If a job throws an error, the job is failed and scheduled for retries with
exponential back-off. We use async/await so assuming you write your task code
well all errors should be cascaded down automatically.

If the worker is terminated (`SIGTERM`, `SIGINT`, etc), it
[triggers a graceful shutdown](https://github.com/graphile/worker/blob/3540df5ab4eb73f846d54959fdfad07897b616f0/src/main.ts#L39-L66) -
i.e. it stops accepting new jobs, waits for the existing jobs to complete, and
then exits. If you need to restart your worker, you should do so using this
graceful process.

If the worker completely dies unexpectedly (e.g. `process.exit()`, segfault,
`SIGKILL`) then those jobs remain locked for 4 hours, after which point they're
available to be processed again automatically. You can free them up earlier than
this by clearing the `locked_at` and `locked_by` columns on the relevant tables.

If the worker schema has not yet been installed into your database, the
following error may appear in your PostgreSQL server logs. This is completely
harmless and should only appear once as the worker will create the schema for
you.

```
ERROR: relation "graphile_worker.migrations" does not exist at character 16
STATEMENT: select id from "graphile_worker".migrations order by id desc limit 1;
```

### Error codes

- `GWBID` - Task identifier is too long (max length: 128).
- `GWBQN` - Job queue name is too long (max length: 128).
- `GWBJK` - Job key is too long (max length: 512).
- `GWBMA` - Job maximum attempts must be at least 1.
- `GWBKM` - Invalid job_key_mode value, expected 'replace', 'preserve_run_at' or
  'unsafe_dedupe'.

## Development

```
yarn
yarn watch
```

In another terminal:

```
createdb graphile_worker_test
yarn test
```

### Using the official Docker image

```
docker pull graphile/worker
```

When using the Docker image you can pass any supported options to the command
line or use the supported environment variables. For the current list of
supported command line options you can run:

`docker run --init --rm -it graphile/worker --help`

Adding tasks to execute is done by mounting the `tasks` directory as a volume
into the `/worker` directory.

The following example has a `tasks` directory in the current directory on the
Docker host. The PostgreSQL server is also running on the same host.

```bash
docker run \
  --init \
  --rm -it \
  --network=host \
  -v "$PWD/tasks":/worker/tasks \
  graphile/worker \
    -c "postgres://postgres:postgres@localhost:5432/postgres"
```

### Using Docker to develop this module

Start the dev db and app in the background

```
docker-compose up -d
```

Run the tests

```
docker-compose exec app yarn jest -i

```

Reset the test db

```
cat __tests__/reset-db.sql | docker-compose exec -T db psql -U postgres -v GRAPHILE_WORKER_SCHEMA=graphile_worker graphile_worker_test
```

Run the perf tests

```
docker-compose exec app node ./perfTest/run.js
```

monitor the container logs

```
docker-compose logs -f db
docker-compose logs -f app
```

### Database migrations

New database migrations must be accompanied by an updated db dump. This can be
generated using the command `yarn db:dump`, and requires a running postgres 11
server. Using docker:

```
docker run -e POSTGRES_HOST_AUTH_METHOD=trust -d -p 5432:5432 postgres:11
```

then run

```
PGUSER=postgres PGHOST=localhost yarn db:dump
```

## Thanks for reading!

If this project helps you out, please
[sponsor ongoing development](https://www.graphile.org/sponsor/).
