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
[PostGraphile](https://www.graphile.org/postgraphile/) or [PostgREST](http://postgrest.org/).

## Crowd-funded open-source software

To help us develop this software sustainably under the MIT license, we ask
all individuals and businesses that use it to help support its ongoing
maintenance and development via sponsorship.

### [Click here to find out more about sponsors and sponsorship.](https://www.graphile.org/sponsor/)

And please give some love to our featured sponsors 🤩:

<table><tr>
<td align="center"><a href="http://chads.website/"><img src="https://www.graphile.org/images/sponsors/chadf.png" width="90" height="90" alt="Chad Furman" /><br />Chad Furman</a></td>
<td align="center"><a href="https://storyscript.io/?utm_source=postgraphile"><img src="https://www.graphile.org/images/sponsors/storyscript.png" width="90" height="90" alt="Storyscript" /><br />Storyscript</a></td>
</tr></table>

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
#   npx graphile-worker -c "postgres://user:pass@host:port/db?ssl=1"
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
    { name: "Bobby Tables" }
  );
}

main().catch(err => {
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

Please support development of this project [via
sponsorship](https://graphile.org/sponsor/). With your support we can improve
performance, usability and documentation at a greater rate, leading to reduced
running and engineering costs for your organisation, leading to a net ROI.

Professional support contracts are also available; for more information see:
https://graphile.org/support/

## Features

- Standalone and embedded modes
- Designed to be used both from JavaScript or directly in the database
- Easy to test (recommended: `runTaskListOnce` util)
- Low latency (typically under 3ms from task schedule to execution, uses `LISTEN`/`NOTIFY` to be informed of jobs as they're inserted)
- High performance (uses `SKIP LOCKED` to find jobs to execute, resulting in faster fetches)
- Small tasks (uses explicit task names / payloads resulting in minimal serialisation/deserialisation overhead)
- Parallel by default
- Adding jobs to same named queue runs them in series
- Automatically re-attempts failed jobs with exponential back-off
- Customisable retry count (default: 25 attempts over ~3 days)
- Task de-duplication via unique `job_key`
- Open source; liberal MIT license
- Executes tasks written in Node.js (these can call out to any other language or networked service)
- Modern JS with 100% async/await API (no callbacks)
- Written natively in TypeScript
- Watch mode for development (experimental - iterate your jobs without restarting worker)
- If you're running really lean, you can run Graphile Worker in the same Node
  process as your server to keep costs and devops complexity down.

## Status

Production ready (and used in production).

We're still enhancing/iterating the library rapidly, hence the 0.x numbering;
updating to a new "minor" version (0.y) may require some small code
modifications, particularly to TypeScript type names; these are documented in
the changelog.

This specific codebase is fairly young, but it's based on years of
implementing similar job queues for Postgres.

To give feedback please raise an issue or reach out on discord:
http://discord.gg/graphile

## Requirements

PostgreSQL 10+\* and Node 10+\*.

If your database doesn't already include the `pgcrypto` extension
we'll automatically install it into the public schema for you. If the
extension is installed in a different schema (unlikely) you may face issues.
Making alias functions in the public schema, should solve this issue (see issue [#43](https://github.com/graphile/worker/issues/43) for an example).

\* Might work with older versions, but has not been tested.

## Installation

```
yarn add graphile-worker
# or: npm install --save graphile-worker
```

## Running

`graphile-worker` manages it's own database schema (`graphile_worker`). Just
point graphile-worker at your database and we handle our own migrations:

```
npx graphile-worker -c "postgres:///my_db"
```

(`npx` looks for the `graphile-worker` binary locally; it's often better to
use the `"scripts"` entry in `package.json` instead.)

The following CLI options are available:

```
Options:
  --help               Show help                                       [boolean]
  --version            Show version number                             [boolean]
  --connection, -c     Database connection string, defaults to the
                       'DATABASE_URL' envvar                            [string]
  --schema, -s         The database schema in which Graphile Worker is (to be)
                       located             [string] [default: "graphile_worker"]
  --schema-only        Just install (or update) the database schema, then exit
                                                      [boolean] [default: false]
  --once               Run until there are no runnable jobs left, then exit
                                                      [boolean] [default: false]
  --watch, -w          [EXPERIMENTAL] Watch task files for changes,
                       automatically reloading the task code without restarting
                       worker                         [boolean] [default: false]
  --jobs, -j           number of jobs to run concurrently  [number] [default: 1]
  --max-pool-size, -m  maximum size of the PostgreSQL pool[number] [default: 10]
  --poll-interval      how long to wait between polling for jobs in milliseconds
                       (for jobs scheduled in the future/retries)
                                                        [number] [default: 2000]
```

## Library usage: running jobs

`graphile-worker` can be used as a library inside your Node.js application.
There are two main use cases for this: running jobs, and queueing jobs. Here
are the APIs for running jobs.

### `run(options: RunnerOptions): Promise<Runner>`

Runs until either stopped by a signal event like `SIGINT` or by calling the `stop()` function on the Runner object `run()` resolves to.

The Runner object also contains a `addJob` method (see [`addJob`](#addjob))
that can be used to enqueue jobs:

```js
await runner.addJob("testTask", {
  thisIsThePayload: true,
});
```

### `runOnce(options: RunnerOptions): Promise<void>`

Equivalent to running the CLI with the `--once` flag. The function will run until there are no runnable jobs left, and then resolve.

### `runMigrations(options: RunnerOptions): Promise<void>`

Equivalent to running the CLI with the `--schema-only` option. Runs the
migrations and then resolves.

### RunnerOptions

The following options for these methods are available.

- `concurrency`: The equivalent of the CLI `--jobs` option with the same default value.
- `nohandleSignals`: If set true, we won't install signal handlers and it'll be up to you to handle graceful shutdown of the worker if the process receives a signal.
- `pollInterval`: The equivalent of the CLI `--poll-interval` option with the same default value.
- `logger`: To change how log messages are output you may provide a custom logger; see [`Logger`](#logger) below
- the database is identified through one of these options:
  - `connectionString`: A PostgreSQL connection string to the database containing the job queue, or
  - `pgPool`: A `pg.Pool` instance to use
- the tasks to execute are identified through one of these options:
  - `taskDirectory`: A path string to a directory containing the task handlers.
  - `taskList`: An object with the task names as keys and a corresponding task handler functions as values
- `schema` can be used to change the default `graphile_worker` schema to something else (equivalent to `--schema` on the CLI)

Exactly one of either `taskDirectory` or `taskList` must be provided (except for `runMigrations` which doesn't require a task list).

Either `connectionString` or `pgPool` must be provided, or the `DATABASE_URL`
envvar must be set.

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
      { value: 42 }

      // Optionally, add further task spec details here
    );

    // await workerUtils.addJob(...);
    // await workerUtils.addJob(...);
    // await workerUtils.addJob(...);
  } finally {
    await workerUtils.release();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

We recommend building one instance of WorkerUtils and sharing it as a
singleton throughout your code.

### WorkerUtilsOptions

- exactly one of these keys must be present to determine how to connect to the database:
  - `connectionString`: A PostgreSQL connection string to the database containing the job queue, or
  - `pgPool`: A `pg.Pool` instance to use
- `schema` can be used to change the default `graphile_worker` schema to something else (equivalent to `--schema` on the CLI)

### WorkerUtils

A `WorkerUtils` instance has the following methods:

- `addJob(name: string, payload: JSON, spec: TaskSpec)` - a method you can call to enqueue a job, see [addJob](#addjob).
- `migrate()` - a method you can call to update the graphile-worker database schema; returns a promise.
- `release()` - call this to release the `WorkerUtils` instance. It's typically best to use `WorkerUtils` as a singleton, so you often won't need this, but it's useful for tests or processes where you want Node to exit cleanly when it's done.

### `quickAddJob(options: WorkerUtilsOptions, ...addJobArgs): Promise<Job>`

If you want to quickly add a job and you don't mind the cost of opening a DB
connection pool and then cleaning it up right away _for every job added_,
there's the `quickAddJob` convenience function. It takes the same options as
`makeWorkerUtils` as the first argument; the remaining arguments are for
[`addJob`](#addjob).

NOTE: you are recommended to use `makeWorkerUtils` instead where possible, but in
one-off scripts this convenience method may be enough.

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
    { value: 42 }

    // Optionally, add further task spec details here
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

## addJob

The `addJob` API exists in many places in graphile-worker, but all the
instances have exactly the same call signature. The API is used to add a job
to the queue for immediate or delayed execution. With `jobKey` it can also be
used to replace existing jobs.

NOTE: `quickAddJob` is similar to `addJob`, but accepts an additional initial
parameter describing how to connect to the database).

The `addJob` arguments are as follows:

- `identifier`: the name of the task to be executed
- `payload`: an optional JSON-compatible object to give the task more context on what it is doing
- `options`: an optional object specifying:
  - `queueName`: the queue to run this task under
  - `runAt`: a Date to schedule this task to run in the future
  - `maxAttempts`: how many retries should this task get? (Default: 25)
  - `jobKey`: unique identifier for the job, used to update or remove it later if needed (see [Updating and removing jobs](#updating-and-removing-jobs)); can also be used for de-duplication

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
  spec?: TaskSpec
) => Promise<Job>;

export interface TaskSpec {
  /**
   * The queue to run this task under (specify if you want the job to run
   * serially).
   */
  queueName?: string;

  /**
   * A Date to schedule this task to run in the future
   */
  runAt?: Date;

  /**
   * How many retries should this task get? (Default: 25)
   */
  maxAttempts?: number;

  /**
   * Unique identifier for the job, can be used to update or remove it later if needed
   */
  jobKey?: string;
}
```

## Logger

You may customise where log messages from `graphile-worker` (and your tasks)
go by supplying a custom `Logger` instance using your own `logFactory`.

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

Your `logFactory` function will be passed a scope object which may contain the following keys (all optional):

- `label` (string): a rough description of the type of action ('watch', 'worker' and 'job' are the currently used values).
- `workerId` (string): the ID of the worker instance
- `taskIdentifier` (string): the task name (identifier) of the running job
- `jobId` (number): the id of the running job

And it should return a logger function which will receive these three arguments:

- `level` ('error', 'warning', 'info' or 'debug') - severity of the log message
- `message` (string) - the log message itself
- `meta` (optional object) - may contain other useful metadata, useful in structured logging systems

The return result of the logger function is currently ignored; but we strongly recommend that for future compatibility you do not return anything from your logger function.

See `consoleLogFactory` in [src/logger.ts](src/logger.ts) for an example logFactory.

**NOTE**: you do not need to (and should not) customise, inherit or extend the `Logger` class at all.

## Creating task executors

A task executor is a simple async JS function which receives as input the job
payload and a collection of helpers. It does the work and then returns. If it
returns then the job is deemed a success and is deleted from the queue. If it
throws an error then the job is deemed a failure and the task is rescheduled
using an exponential-backoff algorithm.

**IMPORTANT**: your jobs should wait for all asynchronous work to be completed
before returning, otherwise we might mistakenly think they were successful.

**IMPORTANT**: we automatically retry the job if it fails, so it's often
sensible to split large jobs into smaller jobs, this also allows them to run
in parallel resulting in faster execution. This is particularly important
for tasks that are not idempotent (i.e. running them a second time will
have extra side effects) - for example sending emails.

Tasks are created in the `tasks` folder in the directory from which you run
`graphile-worker`; the name of the file (less the `.js` suffix) is used as
the task identifier. Currently only `.js` files that can be directly loaded
by Node.js are supported; if you are using Babel, TypeScript or similar you
will need to compile your tasks into the `tasks` folder.

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
module.exports = async payload => {
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
  - `job` - the whole job (including `uuid`, `attempts`, etc) - you shouldn't need this
  - `withPgClient` - a helper to use to get a database client
  - `query(sql, values)` - a convenience wrapper for `withPgClient(pgClient => pgClient.query(sql, values))`
  - `addJob` - a helper to schedule a job

### helpers

#### `helpers.logger`

So that you may redirect logs to your preferred logging provider, we have
enabled you to supply your own logging provider. Overriding this is currently
only available in library mode. We then wrap this logging provider with a
helper class to ease debugging; the helper class has the following methods:

- `error(message, meta?)`: for logging errors, similar to `console.error`
- `warn(message, meta?)`: for logging warnings, similar to `console.warn`
- `info(message, meta?)`: for logging informational messages, similar to `console.info`
- `debug(message, meta?)`: to aid with debugging, similar to `console.log`
- `scope(additionalScope)`: returns a new `Logger` instance with additional scope information

#### `helpers.withPgClient(callback)`

`withPgClient` gets a `pgClient` from the pool, calls `await callback(pgClient)`, and finally releases the client and returns the result of
`callback`. This workflow makes testing your tasks easier.

Example:

```js
const {
  rows: [row],
} = await withPgClient(pgClient => pgClient.query("select 1 as one"));
```

#### `helpers.addJob(identifier, payload?, options?)`

See [`addJob`](#addjob)

## More detail on scheduling jobs through SQL

You can schedule jobs directly in the database, e.g. from a trigger or
function, or by calling SQL from your application code. You do this using the
`graphile_worker.add_job` function.

NOTE: the [`addJob`](#addjob) JavaScript method simply defers to this underlying
`add_job` SQL function.

`add_job` accepts the following parameters (in this order):

- `identifier` - the only **required** field, indicates the name of the task executor to run (omit the `.js` suffix!)
- `payload` - a JSON object with information to tell the task executor what to do (defaults to an empty object)
- `queue_name` - if you want certain tasks to run one at a time, add them to the same named queue (defaults to a random value)
- `run_at` - a timestamp after which to run the job; defaults to now.
- `max_attempts` - if this task fails, how many times should we retry it? Default: 25.
- `job_key` - unique identifier for the job, used to update or remove it later if needed (see [Updating and removing jobs](#updating-and-removing-jobs)); can also be used for de-duplication

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

It's recommended that you use [PostgreSQL's named parameters](https://www.postgresql.org/docs/current/sql-syntax-calling-funcs.html#SQL-SYNTAX-CALLING-FUNCS-NAMED) for the other parameters so that you only need specify the arguments you're using:

```sql
SELECT graphile_worker.add_job('reminder', run_at := NOW() + INTERVAL '2 days');
```

**TIP**: if you want to run a job after a variable number of seconds according
to the database time (rather than the application time), you can use
interval multiplication; see `run_at` in this example:

```sql
SELECT graphile_worker.add_job(
  $1,
  payload := $2,
  queue_name := $3,
  max_attempts := $4,
  run_at := NOW() + ($5 * INTERVAL '1 second')
);
```

**NOTE:** `graphile_worker.add_job(...)` requires database owner privileges
to execute. To allow lower-privileged users to call it, wrap it inside a
PostgreSQL function marked as `SECURITY DEFINER` so that it will run
with the same privileges as the more powerful user that defined it. (Be
sure that this function performs any access checks that are necessary.)

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

If your tables are all defined with a single primary key named `id` then you
can define a more convenient dynamic trigger function which can be called from
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

## Updating and removing jobs

Jobs scheduled with a `job_key` parameter may be updated later, provided they are still pending, by calling `add_job` again with the same `job_key` value. This can be used for rescheduling jobs or to ensure only one of a given job is scheduled at a time. When a job is updated, any omitted parameters are reset to their defaults, with the exception of `queue_name` which persists unless overridden. For example after the below SQL transaction, the `send_email` job will run only once, with the payload `'{"count": 2}'`:

```sql
BEGIN;
SELECT graphile_worker.add_job('send_email', '{"count": 1}', job_key := 'abc');
SELECT graphile_worker.add_job('send_email', '{"count": 2}', job_key := 'abc');
COMMIT;
```

Pending jobs may also be removed using `job_key`:

```sql
SELECT graphile_worker.remove_job('abc');
```

**Note:** If a job is updated using `add_job` once it is already running or completed, the second job will be scheduled separately, meaning both will run. Likewise, calling `remove_job` for a running or completed job is a no-op.

## Administration functions

When implementing an administrative UI you may need more control over the
jobs. For this we have added a few administrative functions that can be
called in SQL or through the JS API. The JS API is exposed via a
`WorkerUtils` instance; see `makeWorkerUtils` above.

**IMPORTANT**: if you choose to run `UPDATE` or `DELETE` commands against the
underlying tables, be sure to _NOT_ manipulate jobs that are locked as this
could have unintended consequences. The following administrative functions
will automatically ensure that the jobs are not locked before applying any
changes.

### Complete jobs

SQL: `SELECT * FROM graphile_worker.complete_jobs(ARRAY[7, 99, 38674, ...])`;

JS: `const deletedJobs = await workerUtils.completeJobs([7, 99, 38674, ...]);`

Marks the specified jobs (by their ids) as if they were completed, assuming
they are not locked. Note that completing a job deletes it. You may mark
failed and permanently failed jobs as completed if you wish. The deleted
jobs will be returned (note that this may be fewer jobs than you requested).

### Permanently fail jobs

SQL: `SELECT * FROM graphile_worker.permanently_fail_jobs(ARRAY[7, 99, 38674, ...], 'Enter reason here')`;

JS: `const updatedJobs = await workerUtils.permanentlyFailJobs([7, 99, 38674, ...], 'Enter reason here');`

Marks the specified jobs (by their ids) as failed permanently, assuming they
are not locked. This means setting their `attempts` equal to their
`max_attempts`. The updated jobs will be returned (note that this may be fewer
jobs than you requested).

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

Updates the specified scheduling properties of the jobs (assuming they are
not locked). All of the specified options are optional, omitted or null
values will left unmodified.

This method can be used to postpone or advance job execution, or to schedule
a previously failed or permanently failed job for execution. The updated jobs
will be returned (note that this may be fewer jobs than you requested).

## Rationality checks

We recommend that you limit `queue_name`, `task_identifier` and `job_key` to
printable ASCII characters.

- `queue_name` can be at most 128 characters long
- `task_identifier` can be at most 128 characters long
- `job_key` can be at most 512 characters long
- `schema` should be reasonable; max 32 characters is preferred. Defaults to `graphile_worker` (15 chars)

## Uninstallation

To delete the worker code and all the tasks from your database, just run this one SQL statement:

```sql
DROP SCHEMA graphile_worker CASCADE;
```

## Performance

`graphile-worker` is not intended to replace extremely high performance
dedicated job queues, it's intended to be a very easy way to get a reasonably
performant job queue up and running with Node.js and PostgreSQL. But this
doesn't mean it's a slouch by any means - it achieves an average latency from
triggering a job in one process to executing it in another of under 3ms, and
a 12-core database server can process around 10,000 jobs per second.

`graphile-worker` is horizontally scalable. Each instance has a customisable
worker pool, this pool defaults to size 1 (only one job at a time on this
worker) but depending on the nature of your tasks (i.e. assuming they're not
compute-heavy) you will likely want to set this higher to benefit from
Node.js' concurrency. If your tasks are compute heavy you may still wish to
set it higher and then using Node's `child_process` (or Node v11's
`worker_threads`) to share the compute load over multiple cores without
significantly impacting the main worker's runloop.

To test performance, you can run `yarn perfTest`. This runs three tests:

1. a startup/shutdown test to see how fast the worker can startup and exit if
   there's no jobs queued (this includes connecting to the database and ensuring
   the migrations are up to date)
2. a load test - by default this will run
   20,000 [trivial](perfTest/tasks/log_if_999.js) jobs with a parallelism of 4
   (i.e. 4 node processes) and a concurrency of 10 (i.e. 10 concurrent jobs
   running on each node process), but you can configure this in
   `perfTest/run.js`. (These settings were optimised for a 12-core hyperthreading
   machine.)
3. a latency test - determining how long between issuing an `add_job` command
   and the task itself being executed.

### perfTest results:

The test was ran on a 12-core AMD Ryzen 3900 with an M.2 SSD, running both
the workers and the database (and a tonne of Chrome tabs, electron apps, and
what not). Jobs=20000, parallelism=4, concurrency=10.

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

We currently use the formula `exp(least(10, attempt))` to determine the
delays between attempts (the job must fail before the next attempt is
scheduled, so the total time elapsed may be greater depending on how long the
job runs for before it fails). This seems to handle temporary issues well,
after ~4 hours attempts will be made every ~6 hours until the maximum number
of attempts is achieved. The specific delays can be seen below:

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

If the worker is terminated (`SIGTERM`, `SIGINT`, etc), it [triggers a
graceful
shutdown](https://github.com/graphile/worker/blob/3540df5ab4eb73f846d54959fdfad07897b616f0/src/main.ts#L39-L66) -
i.e. it stops accepting new jobs, waits for the existing jobs to complete,
and then exits. If you need to restart your worker, you should do so using
this graceful process.

If the worker completely dies unexpectedly (e.g. `process.exit()`, segfault,
`SIGKILL`) then those jobs remain locked for 4 hours, after which point
they're available to be processed again automatically. You can free them up
earlier than this by clearing the `locked_at` and `locked_by` columns on the
relevant tables.

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

### Using Docker

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

## Thanks for reading!

If this project helps you out, please [sponsor ongoing
development](https://www.graphile.org/sponsor/).
