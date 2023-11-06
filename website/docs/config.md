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
  fileExtensions?: string[];
  gracefulShutdownAbortTimeout?: number;
  maxPoolSize?: number;
  pollInterval?: number;
  preparedStatements?: boolean;
  schema?: string;
  tasksFolder?: string;
}
```

### worker.concurrentJobs

Type: `number | undefined`

Number of jobs to run concurrently.

### worker.connectionString

Type: `string | undefined`

Database connection string.

### worker.crontabFile

Type: `string | undefined`

Override path to crontab file.

### worker.fileExtensions

Type: `string[] | undefined`

A list of file extensions (in priority order) that Graphile Worker should
attempt to import directly when loading tasks. Defaults to
`[".js", ".cjs", ".mjs"]`.

### worker.gracefulShutdownAbortTimeout

Type: `number | undefined`

How long in milliseconds after a gracefulShutdown is triggered should we wait to
trigger the AbortController, which should cancel supported asynchronous actions?

### worker.maxPoolSize

Type: `number | undefined`

Maximum number of concurrent connections to Postgres

### worker.pollInterval

Type: `number | undefined`

### worker.preparedStatements

Type: `boolean | undefined`

### worker.schema

Type: `string | undefined`

The database schema in which Graphile Worker is (to be) located.

### worker.tasksFolder

Type: `string | undefined`

Override path to find tasks

<!--END:OPTIONS-->

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
