import { Pool, PoolClient } from "pg";
import {
  TaskList,
  Worker,
  Job,
  WorkerPool,
  WorkerOptions,
  WorkerPoolOptions,
} from "./interfaces";
import debug from "./debug";
import deferred from "./deferred";
import SIGNALS from "./signals";
import { makeNewWorker } from "./worker";
import {
  makeWithPgClientFromPool,
  makeWithPgClientFromClient,
} from "./helpers";
import { CONCURRENT_JOBS } from "./config";

const allWorkerPools: Array<WorkerPool> = [];

// Exported for testing only
export { allWorkerPools as _allWorkerPools };

debug("Booting worker");

let _registeredSignalHandlers = false;
let _shuttingDown = false;
function registerSignalHandlers() {
  if (_shuttingDown) {
    throw new Error(
      "System has already gone into shutdown, should not be spawning new workers now!"
    );
  }
  if (_registeredSignalHandlers) {
    return;
  }
  _registeredSignalHandlers = true;
  SIGNALS.forEach(signal => {
    debug("Registering signal handler for ", signal);
    const removeHandler = () => {
      debug("Removing signal handler for ", signal);
      process.removeListener(signal, handler);
    };
    const handler = function() {
      // eslint-disable-next-line no-console
      console.error(`Received '${signal}'; attempting graceful shutdown...`);
      setTimeout(removeHandler, 5000);
      if (_shuttingDown) {
        return;
      }
      _shuttingDown = true;
      Promise.all(
        allWorkerPools.map(pool =>
          pool.gracefulShutdown(`Forced worker shutdown due to ${signal}`)
        )
      ).finally(() => {
        removeHandler();
        // eslint-disable-next-line no-console
        console.error(
          `Graceful shutdown attempted; killing self via ${signal}`
        );
        process.kill(process.pid, signal);
      });
    };
    process.on(signal, handler);
  });
}

export function runTaskList(
  tasks: TaskList,
  pgPool: Pool,
  options: WorkerPoolOptions = {}
): WorkerPool {
  debug(`Worker pool options are %O`, options);
  const { workerCount = CONCURRENT_JOBS, ...workerOptions } = options;

  // Clean up when certain signals occur
  registerSignalHandlers();

  const promise = deferred();
  const workers: Array<Worker> = [];

  let listenForChangesClient: PoolClient | null = null;

  const unlistenForChanges = async () => {
    if (listenForChangesClient) {
      const client = listenForChangesClient;
      listenForChangesClient = null;
      // Subscribe to jobs:insert message
      try {
        await client.query('UNLISTEN "jobs:insert"');
      } catch (e) {
        // Ignore
      }
      await client.release();
    }
  };

  const listenForChanges = (
    err: Error | undefined,
    client: PoolClient,
    release: () => void
  ) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error(
        `Error connecting with notify listener (trying again in 5 seconds): ${
          err.message
        }`
      );
      // Try again in 5 seconds
      setTimeout(() => {
        pgPool.connect(listenForChanges);
      }, 5000);
      return;
    }
    listenForChangesClient = client;
    client.on("notification", () => {
      if (listenForChangesClient === client) {
        // Find a worker that's available
        workers.some(worker => worker.nudge());
      }
    });

    // Subscribe to jobs:insert message
    client.query('LISTEN "jobs:insert"');

    // On error, release this client and try again
    client.on("error", (e: Error) => {
      // eslint-disable-next-line no-console
      console.error("Error with database notify listener", e.message);
      listenForChangesClient = null;
      try {
        release();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Error occurred releasing client: " + e.stack);
      }
      pgPool.connect(listenForChanges);
    });

    const supportedTaskNames = Object.keys(tasks);
    // eslint-disable-next-line no-console
    console.log(
      `Worker connected and looking for jobs... (task names: '${supportedTaskNames.join(
        "', '"
      )}')`
    );
  };

  // Create a client dedicated to listening for new jobs.
  pgPool.connect(listenForChanges);

  // This is a representation of us that can be interacted with externally
  const workerPool = {
    release: async () => {
      unlistenForChanges();
      promise.resolve();
      await Promise.all(workers.map(worker => worker.release()));
      const idx = allWorkerPools.indexOf(workerPool);
      allWorkerPools.splice(idx, 1);
    },

    // Make sure we clean up after ourselves even if a signal is caught
    async gracefulShutdown(message: string) {
      try {
        // Release all our workers' jobs
        const workerIds = workers.map(worker => worker.workerId);
        const jobsInProgress: Array<Job> = workers
          .map(worker => worker.getActiveJob())
          .filter((job): job is Job => !!job);
        // Remove all the workers - we're shutting them down manually
        workers.splice(0, workers.length).map(worker => worker.release());
        debug("RELEASING THE JOBS", workerIds);
        const { rows: cancelledJobs } = await pgPool.query(
          `
          SELECT graphile_worker.fail_job(job_queues.locked_by, jobs.id, $2)
          FROM graphile_worker.jobs
          INNER JOIN graphile_worker.job_queues ON (job_queues.queue_name = jobs.queue_name)
          WHERE job_queues.locked_by = ANY($1::text[]) AND jobs.id = ANY($3::int[]);
        `,
          [workerIds, message, jobsInProgress.map(job => job.id)]
        );
        debug(cancelledJobs);
        debug("JOBS RELEASED");
      } catch (e) {
        console.error(e.message); // eslint-disable-line no-console
      }
      // Remove ourself from the list of worker pools
      this.release();
    },

    promise,
  };

  // Ensure that during a forced shutdown we get cleaned up too
  allWorkerPools.push(workerPool);

  // Spawn our workers; they can share clients from the pool.
  const withPgClient = makeWithPgClientFromPool(pgPool);
  for (let i = 0; i < workerCount; i++) {
    workers.push(makeNewWorker(tasks, withPgClient, workerOptions));
  }

  // TODO: handle when a worker shuts down (spawn a new one)

  return workerPool;
}

export const runAllJobs = (
  tasks: TaskList,
  client: PoolClient,
  options: WorkerOptions = {}
) =>
  makeNewWorker(tasks, makeWithPgClientFromClient(client), options, false)
    .promise;
