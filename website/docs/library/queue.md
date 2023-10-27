---
title: "Library: queueing jobs"
sidebar_position: 65
sidebar_label: "Queueing jobs"
---

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

## `makeWorkerUtils()`

```ts
function makeWorkerUtils(options: WorkerUtilsOptions): Promise<WorkerUtils>;
```

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

We recommend building one instance of `WorkerUtils` and sharing it as a
singleton throughout your code.

## `WorkerUtilsOptions`

- exactly one of these keys must be present to determine how to connect to the
  database:
  - `connectionString`: A PostgreSQL connection string to the database
    containing the job queue, or
  - `pgPool`: A `pg.Pool` instance to use
- `schema` can be used to change the default `graphile_worker` schema to
  something else (equivalent to `--schema` on the CLI)

## `WorkerUtils`

A `WorkerUtils` instance has the following methods:

- `addJob(name: string, payload: JSON, spec: TaskSpec)` &mdash; a method you can
  call to enqueue a job, see [addJob](./add-job.md).
- `migrate()` &mdash; a method you can call to update the graphile-worker
  database schema; returns a promise.
- `release()` &mdash; call this to release the `WorkerUtils` instance. It&apos;s
  typically best to use `WorkerUtils` as a singleton, so you often won&apos;t
  need this, but it&apos;s useful for tests or processes where you want Node to
  exit cleanly when it&apos;s done.

## `quickAddJob()`

```ts
function quickAddJob(options: WorkerUtilsOptions, ...addJobArgs): Promise<Job>;
```

If you want to quickly add a job and you don&apos;t mind the cost of opening a
DB connection pool and then cleaning it up right away _for every job added_,
there&apos;s the `quickAddJob` convenience function. It takes the same options
as `makeWorkerUtils` as the first argument; the remaining arguments are for
[`addJob`](./add-job.md).

:::tip

You are recommended to use `makeWorkerUtils` instead where possible, but in
one-off scripts this convenience method may be enough.

:::

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
