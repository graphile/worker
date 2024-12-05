---
title: Configuration
sidebar_position: 41
---

## Configuration in CLI Mode

Graphile Worker in CLI mode does not require a configuration file, but you may
find that having a configuration file means you don't have to remember all the
CLI flags each time you run it.

Graphile Worker is configured via a "Graphile Config preset". A preset is a POJO
(plain old JavaScript object) containing keys such as `extends` (to merge in
extra presets) and `plugins` (to add plugins). In the case of Graphile Worker, a
preset POJO also contains the `worker` key which contains Graphile Worker
settings. In CLI mode, the preset should be the default export of a
`graphile.config.js` (or `.ts`, `.mjs`, etc.) file.

Here's an example in JavaScript:

```ts title="graphile.config.js"
module.exports = {
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
import type {} from "graphile-worker";

const preset: GraphileConfig.Preset = {
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

The CLI extends the default
[Worker Preset](https://github.com/graphile/worker/blob/main/src/preset.ts) with
the preset you provide via a config file, and then further extends it with the
configuration specified via CLI flags. Thus, CLI flags take precedence over the
config file preset, which takes precedence over the default Worker Preset.

:::info

Adding the import statement tells TypeScript about the `GraphileConfig` global
namespace and the properties that
[Graphile Worker adds](https://github.com/graphile/worker/blob/c70e9db03f6ad292dcdb833714741363bd78937d/src/index.ts#L158)
to the `Preset` interface. No code from the `graphile-worker` or
`graphile-config` libraries will be included in the output JavaScript for
`graphile.config.ts` above. See the TypeScript docs for more info about
[declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)
and
[type-only imports](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-3-8.html#type-only-imports-and-export).

:::

## Configuration in Library Mode

Many functions exported from the Graphile Worker library accept a Graphile
Config preset.

```ts
const runner = await run({
  taskDirectory: `${__dirname}/tasks`,
  preset: {
    worker: {
      connectionString: "postgres:///my_db",
      concurrentJobs: 5,
    },
  },
});
```

`runMigrations()`, `runOnce()`, `makeWorkerUtils()`, `quickAddJob()`, and more
functions accept a preset similar to `run()`.

We are in the process of transitioning library mode configuration to be done
primarily with Graphile Config presets. For now, there is overlap between what
can be configured via the preset and via the direct properties of the options
object. If a setting is in both the direct property of the options object and in
the preset, the direct property of the options object takes precedence. In the
following example, Graphile Worker will use the `postgres:///my_db` connection
string and will set `concurrency`/`concurrentJobs` to 2.

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

If you have a TypeScript project that uses Graphile Worker in library mode, we
recommend putting your custom Graphile Config preset in a `graphile.config.ts`
file and importing your custom preset wherever you call the Graphile Worker
library. This allows you to use the `graphile config options` command to show
you details about your specific preset.

```ts title="graphile.config.ts"
import { WorkerPreset } from "graphile-worker";

const MyPreset: GraphileConfig.Preset = {
  extends: [WorkerPreset],
  worker: {
    connectionString: "postgres:///my_db",
  },
};

export default MyPreset;
```

```ts title="index.ts"
import { run } from "graphile-worker";
import MyPreset from "./graphile.config";

async function main() {
  const runner = await run({
    taskDirectory: `${__dirname}/tasks`,
    preset: MyPreset,
  });

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

Number of jobs to run concurrently on a single worker. Defaults to `1`.

### worker.connectionString

Type: `string | undefined`

Database [connection string](./connection-string.md).

### worker.crontabFile

Type: `string | undefined`

The path to a file in which Graphile Worker should look for crontab schedules.
Defaults to `${process.cwd()}/crontab`. (see
[Recurring tasks (crontab)](./cron.md)).

### worker.events

Type: `WorkerEvents | undefined`

A Node.js `EventEmitter` that exposes certain events within the runner (see
[`WorkerEvents`](./worker-events)).

### worker.fileExtensions

Type: `string[] | undefined`

A list of file extensions (in priority order) that Graphile Worker should
attempt to import directly when loading task executors from the file system.
Defaults to `[".js", ".cjs", ".mjs"]`.

### worker.getQueueNameBatchDelay

Type: `number | undefined`

**Experimental**

The window size in milliseconds in which Graphile Worker batches calls for
getting a queue name in a job. This batching is done for efficiency. Increase
this window for greater efficiency. Reduce this window to reduce the latency for
getting an individual queue name. Defaults to `50`.

### worker.gracefulShutdownAbortTimeout

Type: `number | undefined`

How long in milliseconds after a gracefulShutdown is triggered should Graphile
Worker wait to trigger the AbortController, which should cancel supported
asynchronous actions? Defaults to `5_000` or 5 seconds.

### worker.logger

Type: `Logger<{}> | undefined`

A Logger instance (see [Logger](./library/logger)).

### worker.maxPoolSize

Type: `number | undefined`

Maximum number of concurrent connections to Postgres. Must be at least `2`. This
number can be lower than `concurrentJobs`, however a low pool size may cause
issues: if all your pool clients are busy, then no jobs can be started or
released. If in doubt, we recommend setting it to `10` or `concurrentJobs + 2`,
whichever is larger. Defaults to `10`.

:::note

If your task executors use the same pool, then a larger value may be needed for
optimum performance, depending on the nature of the logic in your task
executors.

:::

### worker.maxResetLockedInterval

Type: `number | undefined`

**Experimental**

In milliseconds, the upper bound of how long Graphile Worker will wait between
scans for jobs that have been locked too long. Defaults to `600_000` or 10
minutes (see [`minResetLockedInterval`](#workerminresetlockedinterval)).

### worker.minResetLockedInterval

Type: `number | undefined`

**Experimental**

How often should Graphile Worker scan for and release jobs that have been locked
too long? This is the minimum interval in milliseconds. Graphile Worker will
choose a time between this and
[`maxResetLockedInterval`](#workermaxresetlockedinterval). Defaults to `480_000`
or 8 minutes.

### worker.pollInterval

Type: `number | undefined`

Defaults to `2000`.

### worker.preparedStatements

Type: `boolean | undefined`

Whether Graphile Worker should use prepared statements when querying the
database. Set to `false` for compatibility with pgBouncer < 1.21.0. Defaults to
`true`.

### worker.schema

Type: `string | undefined`

The database schema in which Graphile Worker's tables, functions, views, etc are
located. Database migrations will create or edit things in this schema if
necessary (see [Database schema](./schema)). Defaults to `graphile_worker`.

### worker.taskDirectory

Type: `string | undefined`

The path to a directory in which Graphile Worker should look for task executors.
Defaults to `${process.cwd()}/tasks`.

### worker.useNodeTime

Type: `boolean | undefined`

Set to `true` to use the time as recorded by Node.js rather than PostgreSQL. We
strongly recommend that you ensure the Node.js and PostgreSQL times are
synchronized, making this setting moot. Defaults to `false`.

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
