---
title: "Task executors"
sidebar_position: 45
toc_max_heading_level: 5
---

A &ldquo;job&rdquo; is a description of a single &ldquo;job to be done&rdquo;
stored into the database via the JS `addJob()` function or SQL
`graphile_worker.add_job()` function.

A &ldquo;task&rdquo; is the type of work that a job may take, for example
&ldquo;send email&rdquo;, &ldquo;convert image&rdquo; or &ldquo;process
webhook&rdquo;. A &ldquo;task identifier&rdquo; is a unique name given to a
task, for example `send_email` or `convert_image`. A &ldquo;task executor&rdquo;
is the function to execute when a job with the associated task identifier is
found.

## Task executor function

A task executor is a simple async JS function which: receives as input the job
payload and a collection of helpers, does the work, and then returns. If the
task executor returns successfully then the job is deemed a success and is
deleted from the queue (unless this is a &ldquo;batch job&rdquo;). If it throws
an error (or, equivalently, rejects the promise) then the job is deemed a
failure and the task is rescheduled using an exponential-backoff algorithm.

Each task function is passed two arguments:

- `payload` &mdash; the (JSON) payload you passed when calling
  `graphile_worker.add_job(...)` in the database, or `addJob(...)` via the JS
  API
- `helpers` (see [`helpers`](#helpers) below) &mdash; an object containing:
  - `logger` &mdash; a scoped [Logger](/docs/library/logger) instance, to aid
    tracing/debugging
  - `job` &mdash; the whole job (including `uuid`, `attempts`, etc) &mdash; you
    shouldn't need this
  - `withPgClient` &mdash; a helper to use to get a database client
  - `query(sql, values)` &mdash; a convenience wrapper for
    `withPgClient(pgClient => pgClient.query(sql, values))`
  - `addJob` &mdash; a helper to schedule a job

:::warning Important

Your jobs must wait for all asynchronous work to be completed before returning,
otherwise we might think they were successful prematurely. Every promise that a
task executor triggers must be `await`-ed; task executors _should not_ create
&ldquo;untethered&rdquo; promises.

:::

:::tip

We automatically retry the job if it fails, so it&apos;s often sensible to split
a large job into multiple smaller jobs, this also allows them to run in parallel
resulting in faster execution. This is particularly important for tasks that are
not idempotent (i.e. running them a second time will have extra side effects)
&mdash; for example sending emails.

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

When you run `graphile-worker`, it will look in the current directory for a
folder called `tasks`, and it will recursively look for files suitable to run as
tasks. File names excluding the extension and folder names must only use
alphanumeric characters, underscores and dashes (`/^[A-Za-z0-9_-]+$/`) to be
recognized. Graphile Worker will then attempt to load the file as a task
executor; the task identifier for this will be all the folders and the file name
(excluding the extension) joined with `/` characters; e.g.
`tasks/send_notification.js` would get the identifier `send_notification` and
`tasks/users/emails/verify.js` would get the identifier `users/emails/verify`.
How the file is loaded as a task executor will depend on the file in question
and the plugins you have loaded.

```
current directory
├── package.json
├── node_modules
└── tasks
    ├── send_notification.js
    ├── generate_pdf.js
    └── users
        ├── congratulate.js
        └── emails
            ├── verify.js
            └── send_otp.js
```

### Loading task files

Out of the box, Graphile Worker will load `.js`, `.cjs` and `.mjs` files using
the `import()` function. If the file is a CommonJS module then Worker will
expect `module.exports` to be the task executor function; if the file is an
ECMAScript module (ESM) then Worker will expect the default export to be the
task executor function.

Via plugins, support for other ways of loading task files can be added; look at
the source code of `LoadTaskFromJsPlugin.ts` for inspiration.

## Handling batch jobs

If the payload is an array, then _optionally_ your task may choose to return an
array of the same length, the entries in which are promises. Should any of these
promises reject, then the job will be re-enqueued, but the payload will be
overwritten to only contain the entries associated with the rejected promises
&mdash; i.e. the successful entries will be removed.

## `helpers`

### `helpers.logger`

So that you may redirect logs to your preferred logging provider, we have
enabled you to supply your own logging provider. Overriding this is currently
only available in library mode (see [Logger](/library/logger.md)). We then wrap
this logging provider with a helper class to ease debugging; the helper class
has the following methods:

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
keeping transactions open may decrease Graphile Worker&apos;s performance due to
increasing contention over the pool of database clients.

:::

### `helpers.addJob()`

```ts
await helpers.addJob(identifier, payload, options);
```

See [`addJob`](/library/add-job.md).
