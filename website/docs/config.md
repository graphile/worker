---
title: Configuration
sidebar_position: 41
---

Graphile Worker does not require a configuration file, but you may find that
having a configuration file means you don't have to remember all the CLI flags
each time you run it.

Graphile Worker is configured via a `graphile.config.js` (or `.ts`, `.mjs`, ...)
file. This file must export a "Graphile Config preset" which is a POJO (plain
old JavaScript object) containing keys such as `extends` (to merge in extra
presets), `plugins` (to add plugins) and in our case `worker` which contains the
settings for Graphile Worker.

## Examples

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
import type {} from "graphile-config";
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

:::info

TypeScript uses the imports just so it understands what options are available,
these will not be included in the output JavaScript.

:::

## `worker` options

The options available will be influenced by the plugins and presets you are
using in your configuration (if any). To see the full list, you can use
TypeScript's autocomplete, or run `graphile config options` (assuming you have a
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

Number of jobs to run concurrently.

### worker.connectionString

Type: `string | undefined`

Database [connection string](./connection-string.md).

### worker.crontabFile

Type: `string | undefined`

Override path to crontab file.

### worker.events

Type: `WorkerEvents | undefined`

A Node.js `EventEmitter` that exposes certain events within the runner (see
[`WorkerEvents`](/docs/worker-events)).

### worker.fileExtensions

Type: `string[] | undefined`

A list of file extensions (in priority order) that Graphile Worker should
attempt to import directly when loading tasks. Defaults to
`[".js", ".cjs", ".mjs"]`.

### worker.gracefulShutdownAbortTimeout

Type: `number | undefined`

How long in milliseconds after a gracefulShutdown is triggered should we wait to
trigger the AbortController, which should cancel supported asynchronous actions?

### worker.logger

Type: `Logger<{}> | undefined`

A Logger instance.

### worker.maxPoolSize

Type: `number | undefined`

Maximum number of concurrent connections to Postgres. This number can be lower
than concurrentJobs. However a low pool size may cause you issues. If all your 
pool clients are busy then no jobs can be started and no jobs can be 
released, so it's critical that you don't run out.

### worker.maxResetLockedInterval

Type: `number | undefined`

**Experimental**

The upper bound of how long we'll wait between scans for jobs that have been
locked too long. See `minResetLockedInterval`.

### worker.minResetLockedInterval

Type: `number | undefined`

**Experimental**

How often should we scan for jobs that have been locked too long and release
them? This is the minimum interval, we'll choose a time between this and
`maxResetLockedInterval`.

### worker.pollInterval

Type: `number | undefined`

### worker.preparedStatements

Type: `boolean | undefined`

### worker.schema

Type: `string | undefined`

The database schema in which Graphile Worker is (to be) located.

### worker.taskDirectory

Type: `string | undefined`

Override path to find tasks

### worker.useNodeTime

Type: `boolean | undefined`

Set `true` to use the time as recorded by Node.js rather than PostgreSQL. It's
strongly recommended that you ensure the Node.js and PostgreSQL times are
synchronized, making this setting moot.

<!--END:OPTIONS-->
