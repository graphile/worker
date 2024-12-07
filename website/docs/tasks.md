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

- `payload` &mdash; the JSON payload you passed when calling
  `graphile_worker.add_job(...)` in the database, or `addJob(...)` via the JS
  API
- `helpers` see [`helpers`](#helpers) below

:::warning Important

Your task executors must wait for all asynchronous work for a job to be
completed before returning, otherwise Graphile Worker might think they were
successful prematurely. Every promise that a task executor triggers must be
`await`-ed; task executors _should not_ create &ldquo;untethered&rdquo;
promises.

:::

:::tip

Graphile Worker automatically retries the job if it fails, so it&apos;s often
sensible to split a large job into multiple smaller jobs, this also allows them
to run in parallel resulting in faster execution. This is particularly important
for tasks that are not idempotent (i.e. running them a second time will have
extra side effects) &mdash; for example sending emails.

:::

## Example JS task executors

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

## The task directory

When you run Graphile Worker, it will look in the configured
[`taskDirectory`](./config#workertaskdirectory) for files suitable to run as
tasks.

File names excluding the extension and folder names must only use alphanumeric
characters, underscores, and dashes (`/^[A-Za-z0-9_-]+$/`) to be recognized.

Graphile Worker will then attempt to load the file as a task executor; the task
identifier for this task will be all the folders and the file name (excluding
the extension) joined with `/` characters:

- `${taskDirectory}/send_notification.js` would get the task identifier
  `send_notification`.
- `${taskDirectory}/users/emails/verify.js` would get the task identifier
  `users/emails/verify`.

How the file is loaded as a task executor will depend on the specific file and
the plugins you have loaded.

## Loading JavaScript files

With the default preset, Graphile Worker will load `.js`, `.cjs` and `.mjs`
files as task executors using the `import()` function. If the file is a CommonJS
module, then Worker will expect `module.exports` to be the task executor
function; if the file is an ECMAScript module (ESM) then Worker will expect the
default export to be the task executor function.

You can add support for other ways of loading task executors via plugins; look
at the source code of
[`LoadTaskFromJsPlugin.ts`](https://github.com/graphile/worker/blob/main/src/plugins/LoadTaskFromJsPlugin.ts)
for inspiration.

### Loading TypeScript files

:::tip

For performance and memory usage reasons, we recommend that you compile
TypeScript files to JS and then have Graphile Worker load the JS files.

:::

To load TypeScript files directly as task executors (without precompilation),
one way is to do the following:

1. Install `ts-node`.
2. Add `".ts"` to the `worker.fileExtensions` list in your preset.
3. Run Graphile Worker with the environment variable
   `NODE_OPTIONS="--loader ts-node/esm"` set.

```ts title="Example graphile.config.ts"
import { WorkerPreset } from "graphile-worker";

const preset: GraphileConfig.Preset = {
  extends: [WorkerPreset],
  worker: {
    connectionString: process.env.DATABASE_URL,
    concurrentJobs: 5,
    fileExtensions: [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"],
  },
};

export default preset;
```

```bash title="Running graphile-worker with '--loader ts-node/esm'"
NODE_OPTIONS="--loader ts-node/esm" graphile-worker -c ...
# OR: node --loader ts-node/esm node_modules/.bin/graphile-worker -c ...
```

## Loading executable files

:::warning Experimental

This feature is currently experimental.

:::

If you're running on Linux or Unix (including macOS) then if Graphile Worker
finds an executable file inside of the `taskDirectory` it will create a task
executor for it. When a task of this kind is found, Graphile Worker will execute
the file with the relevant environment variables and pass in the payload
according to the encoding. If the executable exits with code `0` then Graphile
Worker will see this as success. All other exit codes are seen as failure.

This feature is added via the
[LoadTaskFromExecutableFilePlugin plugin](https://github.com/graphile/worker/blob/main/src/plugins/LoadTaskFromExecutableFilePlugin.ts)
in the default
[Worker Preset](https://github.com/graphile/worker/blob/main/src/preset.ts).

### Environment variables

- `GRAPHILE_WORKER_PAYLOAD_FORMAT` &mdash; the encoding that Graphile Worker
  used to pass the payload to the binary. Currently this will be the string
  `json`, but you should check this before processing the payload in case the
  format changes.
- `GRAPHILE_WORKER_TASK_IDENTIFIER` &mdash; the identifier for the task this
  file represents (useful if you want multiple task identifiers to be served by
  the same binary file, e.g. via symlinks)
- `GRAPHILE_WORKER_JOB_ID` &mdash; the ID of the job in the database
- `GRAPHILE_WORKER_JOB_KEY` &mdash; the [Job Key](./job-key.md) the job was
  created with, if any
- `GRAPHILE_WORKER_JOB_ATTEMPTS` &mdash; the number of attempts that we've made
  to execute this job; starts at 1
- `GRAPHILE_WORKER_JOB_MAX_ATTEMPTS` &mdash; the maximum number of attempts
  we'll try
- `GRAPHILE_WORKER_JOB_PRIORITY` &mdash; the numeric priority the job was
  created with
- `GRAPHILE_WORKER_JOB_RUN_AT` &mdash; when the job is scheduled to run (can be
  used to detect delayed jobs)

### Payload format: "json"

In the JSON payload format, your binary will be fed via stdin
`JSON.stringify({payload})`; for example, if you did
`addJob('my_script', {mol: 42})` then your `my_script` task would be sent
`{"payload":{"mol":42}}` via stdin.

## Handling batch jobs

If the payload is an array, then _optionally_ your task executor may choose to
return an array of the same length, the entries in which are promises. Should
any of these promises reject, then the job will be re-enqueued, but the payload
will be overwritten to only contain the entries associated with the rejected
promises &mdash; i.e. the successful entries will be removed.

## `helpers`

### `helpers.abortPromise`

**Experimental**

This is a promise that will reject when [`abortSignal`](#helpersabortsignal)
aborts. This makes it convenient for exiting your task when the abortSignal
fires: `Promise.race([abortPromise, doYourAsyncThing()])`.

### `helpers.abortSignal`

**Experimental**

This is a `AbortSignal` that will be triggered when the job should exit early.
It is used, for example, for a graceful shutdown request. `AbortSignal`s can be
passed to a number of asynchronous Node.js methods like
[`http.request()`](https://nodejs.org/api/http.html#httprequesturl-options-callback).

### `helpers.addJob()`

See [`addJob`](/library/add-job.md).

### `helpers.addJobs()`

See [`addJobs`](/library/add-job.md#add-jobs).

### `helpers.getQueueName()`

Get the queue name of the given queue ID (or of the currently executing job if
no queue ID is specified). This function may or may not return a promise. We
recommend that you always `await` it.

### `helpers.job`

The whole, currently executing job, including `uuid`, `attempts`, etc.

### `helpers.logger`

A logger instance scoped to this job. See [Logger](./library/logger)

### `helpers.query()`

This is a convenience wrapper for
`withPgClient(pgClient => pgClient.query(sql, values))`. See
[`withPgClient()`](#helperswithpgclient)

### `helpers.withPgClient()`

`withPgClient` gets a `pgClient` from the pool that Graphile Worker uses. It
calls `await callback(pgClient)`, and finally releases the client and returns
the result of `callback`. This workflow can make testing your tasks easier.

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
