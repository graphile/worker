# Graphile-Worker delegation to GCP Cloud Tasks

[Cloud Tasks](https://cloud.google.com/tasks/) is a fully managed service that
allows you to manage the execution, dispatch, and delivery of a large number of
distributed tasks. You can use `graphile-worker` to export jobs to the queue.

### Why delegate to Cloud Tasks?

There are several reasons you might want to delegate from Graphile Worker to
Cloud Tasks, common ones are:

- You already have tasks and workers set up in a GCP project. Graphile Worker
  delegation will allow you to integrate Postgres triggers directly into Cloud
  Tasks.
- You need a fully managed zero-ops Task queue with a GUI and deeper logs &
  monitoring integrations

# Tutorial

## Pre-requisites

- You will need a GCP project with billing enabled
- Set up Cloud Tasks following the
  [official docs](https://googleapis.dev/nodejs/tasks/latest/index.html)

## Install Node dependencies

On your project add Graphile worker and Cloud Tasks client library

    yarn add @google-cloud/tasks
    yarn add graphile-worker

or if you use npm

    npm i @google-cloud/tasks
    npm i graphile-worker

## Start a Postgres instance

Make sure your database is running. You can use a locally installed database,
run Postgres on Docker or use Cloud SQL through a proxy. How to set up your
database is out of the scope of this tutorial.

## Create a task file

To create tasks in Cloud Tasks

```js
// tasks/cloud-tasks-exporter.js
const { CloudTasksClient } = require("@google-cloud/tasks");

const client = new CloudTasksClient();

// TODO(developer) configure your queue
const project = process.env.GOOGLE_CLOUD_TASKS_PROJECT;
const location = process.env.GOOGLE_CLOUD_TASKS_LOCATION;
const queue = process.env.GOOGLE_CLOUD_TASKS_QUEUE;

// Construct the fully qualified queue name.
const parent = client.queuePath(project, location, queue);

async function createTask({
  logger,
  endpoint,
  payload,
  delay,
  service = "default",
  httpMethod = "POST",
}) {
  // For details on how to create a Task Object check
  // https://googleapis.dev/nodejs/tasks/latest/google.cloud.tasks.v2beta2.html#.Task
  const task = {
    appEngineHttpRequest: {
      httpMethod,
      relativeUri: `/${endpoint}`,
      appEngineRouting: {
        service,
      },
    },
  };

  if (payload) {
    if (typeof payload === "object") {
      payload = JSON.stringify(payload);
    }
    task.appEngineHttpRequest.body = Buffer.from(payload).toString("base64");
  }

  if (delay) {
    // The time when the task is scheduled to be attempted.
    task.scheduleTime = {
      seconds: delay + Date.now() / 1000,
    };
  }

  // Send create task request.
  logger.info("Sending task");

  const request = { parent, task };
  const [response] = await client.createTask(request);
  const name = response.name;

  logger.info(`Created task ${name}`);

  return name;
}
```

To run Graphile Worker task

```js
// tasks/cloud-tasks-exporter.js
module.exports = async (payload, { logger }) => {
  logger.info(
    `Delegating task to Cloud Tasks with payload ${JSON.stringify(payload)}`,
  );

  await createTask({
    endpoint: "your-task-endpoint",
    payload,
    logger,
  });

  logger.info("Done!");
};
```

## Run the worker and add a job

1. Set required environment variables and start the worker

```bash
  export GOOGLE_CLOUD_TASKS_PROJECT=your-project
  export GOOGLE_CLOUD_TASKS_LOCATION=your-location
  export GOOGLE_CLOUD_TASKS_QUEUE=your-queue
  export DATABASE_URL=your-url
  $(yarn bin)/graphile-worker
```

2. Add a job

```sql
  SELECT graphile_worker.add_job('cloud-task-exporter', '{"foo": "bar"}');
```
