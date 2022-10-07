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
import { failJobs } from "./sql/failJob";
import { resetLockedAt } from "./sql/resetLockedAt";
import { makeNewWorker } from "./worker";

const ENABLE_DANGEROUS_LOGS =
  process.env.GRAPHILE_ENABLE_DANGEROUS_LOGS === "1";

// Wait at most 60 seconds between connection attempts for LISTEN.
const MAX_DELAY = 60 * 1000;

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
  const { logger, events } = processSharedOptions(options);
  if (ENABLE_DANGEROUS_LOGS) {
    logger.debug(`Worker pool options are ${inspect(options)}`, { options });
  }
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
      // Unsubscribe from jobs:insert topic
      try {
        await client.query('UNLISTEN "jobs:insert"');
      } catch (e) {
        // Ignore
      }
      await client.release();
    }
  };
  let active = true;
  let reconnectTimeout: NodeJS.Timer | null = null;

  const compiledSharedOptions = processSharedOptions(options);
  const { minResetLockedInterval, maxResetLockedInterval } =
    compiledSharedOptions;

  const resetLockedDelay = () =>
    Math.ceil(
      minResetLockedInterval +
        Math.random() * (maxResetLockedInterval - minResetLockedInterval),
    );

  let resetLockedAtPromise: Promise<void> | undefined;

  const resetLocked = () => {
    resetLockedAtPromise = resetLockedAt(
      compiledSharedOptions,
      withPgClient,
    ).then(
      () => {
        resetLockedAtPromise = undefined;
        if (active) {
          const delay = resetLockedDelay();
          events.emit("resetLocked:success", { pool: this, delay });
          resetLockedTimeout = setTimeout(resetLocked, delay);
        } else {
          events.emit("resetLocked:success", { pool: this, delay: null });
        }
      },
      (e) => {
        resetLockedAtPromise = undefined;
        // TODO: push this error out via an event.
        if (active) {
          const delay = resetLockedDelay();
          events.emit("resetLocked:failure", { pool: this, error: e, delay });
          resetLockedTimeout = setTimeout(resetLocked, delay);
          logger.error(
            `Failed to reset locked; we'll try again in ${delay}ms`,
            {
              error: e,
            },
          );
        } else {
          events.emit("resetLocked:failure", {
            pool: this,
            error: e,
            delay: null,
          });
          logger.error(
            `Failed to reset locked, but we're shutting down so won't try again`,
            {
              error: e,
            },
          );
        }
      },
    );
    events.emit("resetLocked:started", { pool: this });
  };

  // Reset locked in the first 60 seconds, not immediately because we don't
  // want to cause a thundering herd.
  let resetLockedTimeout: NodeJS.Timeout | null = setTimeout(
    resetLocked,
    Math.random() * Math.min(60000, maxResetLockedInterval),
  );

  // This is a representation of us that can be interacted with externally
  const workerPool: WorkerPool = {
    release: async () => {
      // IMPORTANT: if we assert that `active === true` here, we must ensure this is handled in `gracefulShutdown`
      active = false;
      clearTimeout(resetLockedTimeout!);
      resetLockedTimeout = null;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      events.emit("pool:release", { pool: this });
      unlistenForChanges();
      promise.resolve(resetLockedAtPromise);
      await Promise.all(workers.map((worker) => worker.release()));
      const idx = allWorkerPools.indexOf(workerPool);
      allWorkerPools.splice(idx, 1);
    },

    // Make sure we clean up after ourselves even if a signal is caught
    async gracefulShutdown(message: string) {
      events.emit("pool:gracefulShutdown", { pool: this, message });
      try {
        logger.debug(`Attempting graceful shutdown`);
        // Stop new jobs being added
        active = false;

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
        const cancelledJobs = await failJobs(
          compiledSharedOptions,
          withPgClient,
          workerIds,
          jobsInProgress,
          message,
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
      await this.release();
    },

    promise,
  };

  // Ensure that during a forced shutdown we get cleaned up too
  allWorkerPools.push(workerPool);
  events.emit("pool:create", { workerPool });

  let attempts = 0;
  const listenForChanges = (
    err: Error | undefined,
    client: PoolClient,
    releaseClient: () => void,
  ) => {
    if (!active) {
      // We were released, release this new client and abort
      releaseClient?.();
      return;
    }

    const reconnectWithExponentialBackoff = (err: Error) => {
      events.emit("pool:listen:error", { workerPool, client, error: err });

      attempts++;

      // When figuring the next delay we want exponential back-off, but we also
      // want to avoid the thundering herd problem. For now, we'll add some
      // randomness to it via the `jitter` variable, this variable is
      // deliberately weighted towards the higher end of the duration.
      const jitter = 0.5 + Math.sqrt(Math.random()) / 2;

      // Backoff (ms): 136, 370, 1005, 2730, 7421, 20172, 54832
      const delay = Math.ceil(
        jitter * Math.min(MAX_DELAY, 50 * Math.exp(attempts)),
      );

      logger.error(
        `Error with notify listener (trying again in ${delay}ms): ${err.message}`,
        { error: err },
      );

      reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        events.emit("pool:listen:connecting", { workerPool, attempts });
        pgPool.connect(listenForChanges);
      }, delay);
    };

    if (err) {
      // Try again
      reconnectWithExponentialBackoff(err);
      return;
    }

    //----------------------------------------

    let errorHandled = false;
    function onErrorReleaseClientAndTryAgain(e: Error) {
      if (errorHandled) {
        return;
      }
      errorHandled = true;
      listenForChangesClient = null;
      try {
        release();
      } catch (e) {
        logger.error(`Error occurred releasing client: ${e.stack}`, {
          error: e,
        });
      }

      reconnectWithExponentialBackoff(e);
    }

    function handleNotification() {
      if (listenForChangesClient === client) {
        // Find a worker that's available
        workers.some((worker) => worker.nudge());
      }
    }

    function release() {
      client.removeListener("error", onErrorReleaseClientAndTryAgain);
      client.removeListener("notification", handleNotification);
      client.query('UNLISTEN "jobs:insert"').catch(() => {
        /* ignore errors */
      });
      releaseClient();
    }

    // On error, release this client and try again
    client.on("error", onErrorReleaseClientAndTryAgain);

    //----------------------------------------

    events.emit("pool:listen:success", { workerPool, client });
    listenForChangesClient = client;
    client.on("notification", handleNotification);

    // Subscribe to jobs:insert message
    client.query('LISTEN "jobs:insert"').then(() => {
      // Successful listen; reset attempts
      attempts = 0;
    }, onErrorReleaseClientAndTryAgain);

    const supportedTaskNames = Object.keys(tasks);

    logger.info(
      `Worker connected and looking for jobs... (task names: '${supportedTaskNames.join(
        "', '",
      )}')`,
    );
  };

  // Create a client dedicated to listening for new jobs.
  events.emit("pool:listen:connecting", { workerPool, attempts });
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
) => {
  const withPgClient = makeWithPgClientFromClient(client);
  const compiledSharedOptions = processSharedOptions(options);
  const resetPromise = resetLockedAt(compiledSharedOptions, withPgClient);
  const finalPromise = resetPromise.then(() => {
    const worker = makeNewWorker(
      options,
      tasks,
      makeWithPgClientFromClient(client),
      false,
    );
    finalPromise["worker"] = worker;
    return worker.promise;
  });
  return finalPromise;
};
