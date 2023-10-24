---
title: "Task executors"
sidebar_position: 45
toc_max_heading_level: 5
---

A &ldquo;job&rdquo; is a description of a single &ldquo;job to be done&rdquo; stored into the database
via the JS `addJob()` function or SQL `graphile_worker.add_job()` function.

A &ldquo;task&rdquo; is the type of work that a job may take, for example &ldquo;send email&rdquo;,
&ldquo;convert image&rdquo; or &ldquo;process webhook&rdquo;. A &ldquo;task identifier&rdquo; is a unique name given
to a task, for example `send_email` or `convert_image`. A &ldquo;task executor&rdquo; is the
function to execute when a job with the associated task identifier is found.

## Task executor function

A task executor is a simple async JS function which: receives as input the job
payload and a collection of helpers, does the work, and then returns. If the
task executor returns successfully then the job is deemed a success and is
deleted from the queue (unless this is a "batch job"). If it throws an error
(or, equivalently, rejects the promise) then the job is deemed a failure and the
task is rescheduled using an exponential-backoff algorithm.

Each task function is passed two arguments:

- `payload` - the (JSON) payload you passed when calling
  `graphile_worker.add_job(...)` in the database, or `addJob(...)` via the JS
  API
- `helpers` (see [`helpers`](#helpers) below) - an object containing:
  - `logger` - a scoped [Logger](/docs/library/logger) instance, to aid
    tracing/debugging
  - `job` - the whole job (including `uuid`, `attempts`, etc) - you shouldn't
    need this
  - `withPgClient` - a helper to use to get a database client
  - `query(sql, values)` - a convenience wrapper for
    `withPgClient(pgClient => pgClient.query(sql, values))`
  - `addJob` - a helper to schedule a job

:::warning Important

Your jobs must wait for all asynchronous work to be completed before returning,
otherwise we might think they were successful prematurely. Every promise that a
task executor triggers must be `await`-ed; task executors _should not_ create
"untethered" promises.

:::

:::tip

We automatically retry the job if it fails, so it's often sensible to split a
large job into multiple smaller jobs, this also allows them to run in parallel
resulting in faster execution. This is particularly important for tasks that are
not idempotent (i.e. running them a second time will have extra side effects) -
for example sending emails.

:::

## Example task executors

```js title="tasks/task_1.js"
module.exports = async (payload) => {
  await doMyLogicWith(payload);
};
```

```js title="tasks/task_2.js"
module.exports = async (payload, helpers) => {
  // async is optional, but best practice
  helpers.logger.debug(`Received ${JSON.stringify(payload)}`);
};
```

## The `tasks/` folder

Out of the box, `graphile-worker` will automatically look for `.js` files inside
the `tasks/` folder inside the working directory in which `graphile-worker` is
executed, and will load them as tasks. The name of the file (less the `.js`
suffix) is used as the "task identifier", and the `module.exports` is used as
the task executor function.

```
current directory
├── package.json
├── node_modules
└── tasks
    ├── task_1.js
    └── task_2.js
```

:::note

Currently only `.js` files that can be directly loaded by Node.js are supported;
if you are using Babel, TypeScript or similar you will need to compile your
tasks into the `tasks` folder.

:::

## Handling batch jobs

If the payload is an array, then _optionally_ your task may choose to return an
array of the same length, the entries in which are promises. Should any of these
promises reject, then the job will be re-enqueued, but the payload will be
overwritten to only contain the entries associated with the rejected promises -
i.e. the successful entries will be removed.

## `helpers`

### `helpers.logger`

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

### `helpers.withPgClient()`

`withPgClient` gets a `pgClient` from the pool, calls
`await callback(pgClient)`, and finally releases the client and returns the
result of `callback`. This workflow can make testing your tasks easier.

Example:

```js
const {
  rows: [row],
} = await withPgClient((pgClient) => pgClient.query("select 1 as one"));
```

:::info

Neither `withPgClient` nor `query` methods create a database transaction. If you
need a database transaction, you should do so yourself, but please note that
keeping transactions open may decrease Graphile Worker's performance due to
increasing contention over the pool of database clients.

:::

### `helpers.addJob()`

```ts
await helpers.addJob(identifier, payload, options);
```

See [`addJob`](#addjob)
