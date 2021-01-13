import { EventEmitter } from "events";
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
  WorkerEvents,
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

/**
 * All pools share the same signal handlers, so we need to broadcast
 * gracefulShutdown to all the pools' events; we use this event emitter to
 * aggregate these requests.
 */
let _signalHandlersEventEmitter: WorkerEvents = new EventEmitter();

/**
 * Only register the signal handlers once _globally_.
 */
let _registeredSignalHandlers = false;

/**
 * Only trigger graceful shutdown once.
 */
let _shuttingDown = false;

/**
 * This will register the signal handlers to make sure the worker shuts down
 * gracefully if it can. It will only register signal handlers once; even if
 * you call it multiple times it will always use the first logger it is passed,
 * future calls will register the events but take no further actions.
 */
function registerSignalHandlers(logger: Logger, events: WorkerEvents) {
  if (_shuttingDown) {
    throw new Error(
      "System has already gone into shutdown, should not be spawning new workers now!",
    );
  }
  _signalHandlersEventEmitter.on("gracefulShutdown", (o) =>
    events.emit("gracefulShutdown", o),
  );
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
      _signalHandlersEventEmitter.emit("gracefulShutdown", { signal });
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
  const { logger, escapedWorkerSchema, events } = processSharedOptions(options);
  logger.debug(`Worker pool options are ${inspect(options)}`, { options });
  const { concurrency = defaults.concurrentJobs, noHandleSignals } = options;

  if (!noHandleSignals) {
    // Clean up when certain signals occur
    registerSignalHandlers(logger, events);
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
  let active = true;

  // This is a representation of us that can be interacted with externally
  const workerPool: WorkerPool = {
    release: async () => {
      active = false;
      events.emit("pool:release", { pool: this });
      unlistenForChanges();
      promise.resolve();
      await Promise.all(workers.map((worker) => worker.release()));
      const idx = allWorkerPools.indexOf(workerPool);
      allWorkerPools.splice(idx, 1);
    },

    // Make sure we clean up after ourselves even if a signal is caught
    async gracefulShutdown(message: string) {
      events.emit("pool:gracefulShutdown", { pool: this, message });
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
        events.emit("pool:gracefulShutdown:error", { pool: this, error: e });
        logger.error(`Error occurred during graceful shutdown: ${e.message}`, {
          error: e,
        });
      }
      // Remove ourself from the list of worker pools
      this.release();
    },

    promise,
  };

  // Ensure that during a forced shutdown we get cleaned up too
  allWorkerPools.push(workerPool);
  events.emit("pool:create", { workerPool });

  const listenForChanges = (
    err: Error | undefined,
    client: PoolClient,
    release: () => void,
  ) => {
    if (!active) {
      // We were released, release this new client and abort
      release();
      return;
    }
    if (err) {
      events.emit("pool:listen:error", { workerPool, client, error: err });
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
    events.emit("pool:listen:success", { workerPool, client });
    listenForChangesClient = client;
    client.on("notification", () => {
      if (listenForChangesClient === client) {
        // Find a worker that's available
        workers.some((worker) => worker.nudge());
      }
    });

    // On error, release this client and try again
    client.on("error", (e: Error) => {
      events.emit("pool:listen:error", { workerPool, client, error: e });
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
      events.emit("pool:listen:connecting", { workerPool });
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
  events.emit("pool:listen:connecting", { workerPool });
  pgPool.connect(listenForChanges);

  // Spawn our workers; they can share clients from the pool.
  const withPgClient = makeWithPgClientFromPool(pgPool);
  for (let i = 0; i < concurrency; i++) {
    workers.push(makeNewWorker(options, tasks, withPgClient));
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
