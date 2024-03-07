---
title: "WorkerEvents"
---

We support a large number of events via an EventEmitter. You can either retrieve
the event emitter via the `events` property on the `Runner` object, or you can
create your own event emitter and pass it to Graphile Worker via the
`WorkerOptions.events` option (this is primarily useful for getting events from
the other Graphile Worker entrypoints).

### Example: via `runner.events`

```js
runner.events.on("job:success", ({ worker, job }) => {
  console.log(`Hooray! Worker ${worker.workerId} completed job ${job.id}`);
});
```

### Example: using `EventEmitter`

```js
const events = new EventEmitter();
events.on(...);
events.on(...);
events.on(...);

const runner = await run({events, ...});
```

### Example: In graphile configuration

```js
const events = new EventEmitter();
events.on(...);
events.on(...);
events.on(...);

const preset = {
  worker: {
    events,
    ...
  }
}

```

## Definitions:

Details of what events we support and what data is available on the event
payload is detailed below in TypeScript syntax:

```ts
export type WorkerEvents = TypedEventEmitter<{
  /**
   * When a worker pool is created
   */
  "pool:create": { workerPool: WorkerPool };

  /**
   * When a worker pool attempts to connect to PG ready to issue a LISTEN
   * statement
   */
  "pool:listen:connecting": { workerPool: WorkerPool };

  /**
   * When a worker pool starts listening for jobs via PG LISTEN
   */
  "pool:listen:success": { workerPool: WorkerPool; client: PoolClient };

  /**
   * When a worker pool faces an error on their PG LISTEN client
   */
  "pool:listen:error": {
    workerPool: WorkerPool;
    error: any;
    client: PoolClient;
  };

  /**
   * When a worker pool is released
   */
  "pool:release": { pool: WorkerPool };

  /**
   * When a worker pool starts a graceful shutdown
   */
  "pool:gracefulShutdown": { pool: WorkerPool; message: string };

  /**
   * When a worker pool graceful shutdown throws an error
   */
  "pool:gracefulShutdown:error": { pool: WorkerPool; error: any };

  /**
   * When a worker is created
   */
  "worker:create": { worker: Worker; tasks: TaskList };

  /**
   * When a worker release is requested
   */
  "worker:release": { worker: Worker };

  /**
   * When a worker stops (normally after a release)
   */
  "worker:stop": { worker: Worker; error?: any };

  /**
   * When a worker is about to ask the database for a job to execute
   */
  "worker:getJob:start": { worker: Worker };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:error": { worker: Worker; error: any };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:empty": { worker: Worker };

  /**
   * When a worker is created
   */
  "worker:fatalError": { worker: Worker; error: any; jobError: any | null };

  /**
   * When a job is retrieved by get_job
   */
  "job:start": { worker: Worker; job: Job };

  /**
   * When a job completes successfully
   */
  "job:success": { worker: Worker; job: Job };

  /**
   * When a job throws an error
   */
  "job:error": { worker: Worker; job: Job; error: any };

  /**
   * When a job fails permanently (emitted after job:error when appropriate)
   */
  "job:failed": { worker: Worker; job: Job; error: any };

  /**
   * When a job has finished executing and the result (success or failure) has
   * been written back to the database
   */
  "job:complete": { worker: Worker; job: Job; error: any };

  /**
   * When the runner is terminated by a signal
   */
  gracefulShutdown: { signal: Signal };

  /**
   * When the runner is stopped
   */
  stop: {};
}>;
```
