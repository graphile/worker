---
title: "Library"
sidebar_position: 60
---

There are two main ways to run Graphile Worker: CLI mode and library mode.
Library mode trades some convenience for power, giving you more options as to
how you configure the worker.

We recommend [CLI mode](/docs/cli) for most users.

## Quickstart

Instead of running `graphile-worker` [via the CLI](/docs/cli), you may use it
directly in your Node.js code.

### Add the worker to your project:

```sh npm2yarn
npm install --save graphile-worker
```

### Run the worker

The following is equivalent to the setup in
[the CLI quickstart](/docs/cli#quickstart):

```js
const { run } = require("graphile-worker");

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

  // Immediately await (or otherwise handle) the resulting promise, to avoid
  // "unhandled rejection" errors causing a process crash in the event of
  // something going wrong.
  await runner.promise;

  // If the worker exits (whether through fatal error or otherwise), the above
  // promise will resolve/reject.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Add a job via the library

You can also use the library to quickly add a job:

```js
const { quickAddJob } = require("graphile-worker");

quickAddJob(
  // makeWorkerUtils options
  { connectionString: "postgres:///my_db" },

  // Task identifier
  "hello",

  // Payload
  { name: "Bobby Tables" },
).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

:::tip

Though `quickAddJob` is a quick and easy way for you to add a one-off job, it is
not the recommended to use it in your main application due to inefficiency. It's
fine for one-off scripts like this, but in your main application you should use
[WorkerUtils](/docs/worker-utils)' `addJob` method..

:::

### Success!

Running these two examples should output something like:

```
[core] INFO: Worker connected and looking for jobs... (task names: 'hello')
[job(worker-7327280603017288: hello{1})] INFO: Hello, Bobby Tables
[worker(worker-7327280603017288)] INFO: Completed task 1 (hello) with success (0.16ms)
```
