---
title: Configuration
sidebar_position: 41
---

## Preset

Graphile Worker's most common options can be configured via a "Graphile Config
preset". A preset is a JavaScript object containing keys such as `extends` (to
merge in other presets) and `plugins` (to add plugins). In the case of Graphile
Worker, a preset also contains the `worker` key which contains settings specific
to Graphile Worker.

Graphile Worker does not require a dedicated configuration file, but using one
gives a number of advantages:

- share configuration between library and CLI modes easily
- share common options between multiple differently configured instances
- use tooling such as the `graphile` command that uses the configuration file
  - `graphile config print` prints out your resolved configuration nicely
    formatted
  - `graphile config options` details the options that are available for
    configuration based on the plugins and presets you are using
- you don't have to remember all the flags each time you run the CLI

We therefore recommend that the preset be the default export of a
`graphile.config.js` (or `.ts`, `.mjs`, etc.) file.

Here's an example in JavaScript:

```ts title="graphile.config.js"
const { WorkerPreset } = require("graphile-worker");

module.exports = {
  extends: [WorkerPreset],
  worker: {
    connectionString: process.env.DATABASE_URL,
    maxPoolSize: 10,
    pollInterval: 2000,
    preparedStatements: true,
    schema: "graphile_worker",
    crontabFile: "crontab",
    concurrentJobs: 1,
    fileExtensions: [".js", ".cjs", ".mjs"],
  },
};
```

And an equivalent configuration in TypeScript:

```ts title="graphile.config.ts"
import { WorkerPreset } from "graphile-worker";

const preset: GraphileConfig.Preset = {
  extends: [WorkerPreset],
  worker: {
    connectionString: process.env.DATABASE_URL,
    maxPoolSize: 10,
    pollInterval: 2000,
    preparedStatements: true,
    schema: "graphile_worker",
    crontabFile: "crontab",
    concurrentJobs: 1,
    fileExtensions: [".js", ".cjs", ".mjs"],
  },
};

export default preset;
```

## CLI mode

The CLI extends the default
[Worker Preset](https://github.com/graphile/worker/blob/main/src/preset.ts) with
the preset you provide via a config file, and then further extends it with the
configuration specified via CLI flags. Thus, CLI flags take precedence over the
config file preset, which takes precedence over the default Worker Preset.

## Library mode

Many functions exported from the Graphile Worker library accept a Graphile
Config preset, including `run()`, `runMigrations()`, `runOnce()`,
`makeWorkerUtils()`, `quickAddJob()`, and more.

### Option precedence

We are in the process of transitioning library mode configuration to be done
primarily with Graphile Config presets. For now, there is overlap between what
can be configured via the preset and via the direct properties of the options
object. If a setting is provided by both, the direct property of the options
object takes precedence over the setting from the preset. In the following
example, Graphile Worker will use the `postgres:///my_db` connection string and
will set `concurrency`/`concurrentJobs` to 2.

```ts
const runner = await runOnce({
  taskDirectory: `${__dirname}/tasks`,
  connectionString: "postgres:///my_db",
  // Note that the property names don't always line up perfectly between legacy
  // configuration and the preset options. `concurrency` was renamed to
  // `concurrentJobs`.
  concurrency: 2,
  preset: {
    worker: {
      connectionString: "ignored",
      concurrentJobs: 1,
    },
  },
});
```

### Using a configuration file

Though you can define presets inline like above, we strongly advise that you
keep your configuration in a `graphile.config.js` (or `.ts`, `.mjs`, etc) file
for the reasons explained [in Preset above](#preset).

```ts title="graphile.config.ts"
import { WorkerPreset } from "graphile-worker";

const preset: GraphileConfig.Preset = {
  extends: [WorkerPreset],
  worker: {
    taskDirectory: `${__dirname}/tasks`,
    connectionString: "postgres:///my_db",
  },
};

export default preset;
```

```ts title="index.ts"
import { run } from "graphile-worker";
import preset from "./graphile.config";

async function main() {
  const runner = await run({ preset });
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

## `worker` options

The options available are influenced by the plugins and presets you use in your
configuration (if any). To see the full list, you can use TypeScript's
autocomplete, or run `graphile config options` (assuming you have a
`graphile.config.ts` file).

Here are the options under the `worker` key as defined by
`graphile config options` when no plugins or presets are in use:

<!--BEGIN:OPTIONS-->

```ts
{
  concurrentJobs?: number;
  connectionString?: string;
  crontabFile?: string;
  events?: WorkerEvents;
  fileExtensions?: string[];
  getQueueNameBatchDelay?: number;
  gracefulShutdownAbortTimeout?: number;
  logger?: Logger<{}>;
  maxPoolSize?: number;
  maxResetLockedInterval?: number;
  minResetLockedInterval?: number;
  pollInterval?: number;
  preparedStatements?: boolean;
  schema?: string;
  taskDirectory?: string;
  useNodeTime?: boolean;
}
```

### worker.concurrentJobs

Type: `number | undefined`

Number of jobs to run concurrently on a single Graphile Worker instance.

### worker.connectionString

Type: `string | undefined`

Database [connection string](/docs/connection-string).

### worker.crontabFile

Type: `string | undefined`

The path to a file in which Graphile Worker should look for crontab schedules.
See: [recurring tasks (crontab)](/docs/cron)).

### worker.events

Type: `WorkerEvents | undefined`

Provide your own Node.js `EventEmitter` in order to be able to receive events
(see [`WorkerEvents`](/docs/worker-events)) that occur during Graphile Worker's
startup. (Without this, Worker will provision its own `EventEmitter`, but you
can't retrieve it until the promise returned by the API you have called has
resolved.)

### worker.fileExtensions

Type: `string[] | undefined`

A list of file extensions (in priority order) that Graphile Worker should
attempt to import directly when loading task executors from the file system.

### worker.getQueueNameBatchDelay

Type: `number | undefined`

**Experimental**

The size, in milliseconds, of the time window over which Graphile Worker will
batch requests to retrieve the queue name of a job. Increase the size of this
window for greater efficiency, or reduce it to improve latency.

### worker.gracefulShutdownAbortTimeout

Type: `number | undefined`

How long in milliseconds after a gracefulShutdown is triggered should Graphile
Worker wait to trigger the AbortController, which should cancel supported
asynchronous actions?

### worker.logger

Type: `Logger<{}> | undefined`

A Logger instance (see [Logger](/docs/library/logger)).

### worker.maxPoolSize

Type: `number | undefined`

Maximum number of concurrent connections to Postgres; must be at least `2`. This
number can be lower than `concurrentJobs`, however a low pool size may cause
issues: if all your pool clients are busy then no jobs can be started or
released. If in doubt, we recommend setting it to `10` or `concurrentJobs + 2`,
whichever is larger. (Note: if your task executors use this pool, then an even
larger value may be needed for optimum performance, depending on the shape of
your logic.)

### worker.maxResetLockedInterval

Type: `number | undefined`

**Experimental**

The upper bound of how long (in milliseconds) Graphile Worker will wait between
scans for jobs that have been locked too long (see `minResetLockedInterval`).

### worker.minResetLockedInterval

Type: `number | undefined`

**Experimental**

How often should Graphile Worker scan for and release jobs that have been locked
too long? This is the minimum interval in milliseconds. Graphile Worker will
choose a time between this and `maxResetLockedInterval`.

### worker.pollInterval

Type: `number | undefined`

### worker.preparedStatements

Type: `boolean | undefined`

Whether Graphile Worker should use prepared statements. Set `false` if you use
software (e.g. some Postgres pools) that don't support them.

### worker.schema

Type: `string | undefined`

The database schema in which Graphile Worker's tables, functions, views, etc are
located. Graphile Worker will create or edit things in this schema as necessary.

### worker.taskDirectory

Type: `string | undefined`

The path to a directory in which Graphile Worker should look for task executors.

### worker.useNodeTime

Type: `boolean | undefined`

Set to `true` to use the time as recorded by Node.js rather than PostgreSQL.
It's strongly recommended that you ensure the Node.js and PostgreSQL times are
synchronized, making this setting moot.

<!--END:OPTIONS-->

## Configuration via Environment Variables

Some `worker` options in the default
[Worker Preset](https://github.com/graphile/worker/blob/main/src/preset.ts) will
use environment variables if they are set. Values in your custom preset or CLI
flags will take precedence over environment variables.

```ts
{
  connectionString: process.env.DATABASE_URL,
  schema: process.env.GRAPHILE_WORKER_SCHEMA
}
```
