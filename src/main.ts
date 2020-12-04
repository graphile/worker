import { Pool, PoolClient } from "pg";
import { inspect } from "util";

import { defaults } from "./config";
import deferred from "./deferred";
import {
  makeWithPgClientFromClient,
  makeWithPgClientFromPool,
} from "./helpers";
import {
  Job,
  TaskList,
  Worker,
  WorkerOptions,
  WorkerPool,
  WorkerPoolOptions,
} from "./interfaces";
import { processSharedOptions } from "./lib";
import { Logger } from "./logger";
import SIGNALS from "./signals";
import { makeNewWorker } from "./worker";

const allWorkerPools: Array<WorkerPool> = [];

// Exported for testing only
export { allWorkerPools as _allWorkerPools };

let _registeredSignalHandlers = false;
let _shuttingDown = false;
function registerSignalHandlers(logger: Logger) {
  if (_shuttingDown) {
    throw new Error(
      "System has already gone into shutdown, should not be spawning new workers now!",
    );
  }
  if (_registeredSignalHandlers) {
    return;
  }
  _registeredSignalHandlers = true;
  SIGNALS.forEach((signal) => {
    logger.debug(`Registering signal handler for ${signal}`, {
      registeringSignalHandler: signal,
    });
    const removeHandler = () => {
      logger.debug(`Removing signal handler for ${signal}`, {
        unregisteringSignalHandler: signal,
      });
      process.removeListener(signal, handler);
    };
    const handler = function () {
      logger.error(`Received '${signal}'; attempting graceful shutdown...`);
      setTimeout(removeHandler, 5000);
      if (_shuttingDown) {
        return;
      }
      _shuttingDown = true;
      Promise.all(
        allWorkerPools.map((pool) =>
          pool.gracefulShutdown(`Forced worker shutdown due to ${signal}`),
        ),
      ).finally(() => {
        removeHandler();
        logger.error(`Graceful shutdown attempted; killing self via ${signal}`);
        process.kill(process.pid, signal);
      });
    };
    process.on(signal, handler);
  });
}

export function runTaskList(
  options: WorkerPoolOptions,
  tasks: TaskList,
  pgPool: Pool,
): WorkerPool {
  const { logger, escapedWorkerSchema } = processSharedOptions(options);
  logger.debug(`Worker pool options are ${inspect(options)}`, { options });
  const {
    concurrency = defaults.concurrentJobs,
    noHandleSignals,
    ...workerOptions
  } = options;

  if (!noHandleSignals) {
    // Clean up when certain signals occur
    registerSignalHandlers(logger);
  }

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

  // This is a representation of us that can be interacted with externally
  const workerPool = {
    release: async () => {
      unlistenForChanges();
      promise.resolve();
      await Promise.all(workers.map((worker) => worker.release()));
      const idx = allWorkerPools.indexOf(workerPool);
      allWorkerPools.splice(idx, 1);
    },

    // Make sure we clean up after ourselves even if a signal is caught
    async gracefulShutdown(message: string) {
      try {
        logger.debug(`Attempting graceful shutdown`);
        // Release all our workers' jobs
        const workerIds = workers.map((worker) => worker.workerId);
        const jobsInProgress: Array<Job> = workers
          .map((worker) => worker.getActiveJob())
          .filter((job): job is Job => !!job);
        // Remove all the workers - we're shutting them down manually
        workers.splice(0, workers.length).map((worker) => worker.release());
        logger.debug(`Releasing the jobs '${workerIds.join(", ")}'`, {
          workerIds,
        });
        const { rows: cancelledJobs } = await pgPool.query(
          `
          SELECT ${escapedWorkerSchema}.fail_job(job_queues.locked_by, jobs.id, $2)
          FROM ${escapedWorkerSchema}.jobs
          INNER JOIN ${escapedWorkerSchema}.job_queues ON (job_queues.queue_name = jobs.queue_name)
          WHERE job_queues.locked_by = ANY($1::text[]) AND jobs.id = ANY($3::int[]);
        `,
          [workerIds, message, jobsInProgress.map((job) => job.id)],
        );
        logger.debug(`Cancelled ${cancelledJobs.length} jobs`, {
          cancelledJobs,
        });
        logger.debug("Jobs released");
      } catch (e) {
        logger.error(`Error occurred during graceful shutdown: ${e.message}`, {
          error: e,
        });
      }
      // Remove ourself from the list of worker pools
      this.release();
    },

    promise,
  };

  const listenForChanges = (
    err: Error | undefined,
    client: PoolClient,
    release: () => void,
  ) => {
    if (err) {
      logger.error(
        `Error connecting with notify listener (trying again in 5 seconds): ${err.message}`,
        { error: err },
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
        workers.some((worker) => worker.nudge());
      }
    });

    // On error, release this client and try again
    client.on("error", (e: Error) => {
      logger.error(`Error with database notify listener: ${e.message}`, {
        error: e,
      });
      listenForChangesClient = null;
      try {
        release();
      } catch (e) {
        logger.error(`Error occurred releasing client: ${e.stack}`, {
          error: e,
        });
      }
      pgPool.connect(listenForChanges);
    });

    // Subscribe to jobs:insert message
    client.query('LISTEN "jobs:insert"');

    const supportedTaskNames = Object.keys(tasks);

    logger.info(
      `Worker connected and looking for jobs... (task names: '${supportedTaskNames.join(
        "', '",
      )}')`,
    );
  };

  // Create a client dedicated to listening for new jobs.
  pgPool.connect(listenForChanges);

  // Ensure that during a forced shutdown we get cleaned up too
  allWorkerPools.push(workerPool);

  // Spawn our workers; they can share clients from the pool.
  const withPgClient = makeWithPgClientFromPool(pgPool);
  for (let i = 0; i < concurrency; i++) {
    workers.push(makeNewWorker(workerOptions, tasks, withPgClient));
  }

  // TODO: handle when a worker shuts down (spawn a new one)

  return workerPool;
}

export const runTaskListOnce = (
  options: WorkerOptions,
  tasks: TaskList,
  client: PoolClient,
) =>
  makeNewWorker(options, tasks, makeWithPgClientFromClient(client), false)
    .promise;
