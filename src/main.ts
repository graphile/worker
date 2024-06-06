import { randomBytes } from "crypto";
import { EventEmitter } from "events";
import { Notification, Pool, PoolClient } from "pg";
import { inspect } from "util";

import deferred from "./deferred";
import {
  makeWithPgClientFromClient,
  makeWithPgClientFromPool,
} from "./helpers";
import {
  CompleteJobFunction,
  EnhancedWithPgClient,
  FailJobFunction,
  GetJobFunction,
  Job,
  RunOnceOptions,
  TaskList,
  WorkerEventMap,
  WorkerEvents,
  WorkerPool,
  WorkerPoolOptions,
} from "./interfaces";
import {
  CompiledSharedOptions,
  makeEnhancedWithPgClient,
  processSharedOptions,
  tryParseJson,
} from "./lib";
import { Logger } from "./logger";
import SIGNALS, { Signal } from "./signals";
import { completeJob as baseCompleteJob } from "./sql/completeJob";
import { failJob as baseFailJob, failJobs } from "./sql/failJob";
import { getJob as baseGetJob } from "./sql/getJob";
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
const _signalHandlersEventEmitter: WorkerEvents = new EventEmitter();

/**
 * Only register the signal handlers once _globally_.
 */
let _registeredSignalHandlers = false;

/**
 * Only trigger graceful shutdown once.
 */
let _shuttingDownGracefully = false;
let _shuttingDownForcefully = false;

let _registeredSignalHandlersCount = 0;

/**
 * This will register the signal handlers to make sure the worker shuts down
 * gracefully if it can. It will only register signal handlers once; even if
 * you call it multiple times it will always use the first logger it is passed,
 * future calls will register the events but take no further actions.
 */
function registerSignalHandlers(
  logger: Logger,
  events: WorkerEvents,
): () => void {
  if (_shuttingDownGracefully || _shuttingDownForcefully) {
    throw new Error(
      "System has already gone into shutdown, should not be spawning new workers now!",
    );
  }

  const gscb = (o: WorkerEventMap["gracefulShutdown"]) =>
    events.emit("gracefulShutdown", o);
  const fscb = (o: WorkerEventMap["forcefulShutdown"]) =>
    events.emit("forcefulShutdown", o);

  if (!_registeredSignalHandlers) {
    _reallyRegisterSignalHandlers(logger);
  }

  _registeredSignalHandlersCount++;
  _signalHandlersEventEmitter.on("gracefulShutdown", gscb);
  _signalHandlersEventEmitter.on("forcefulShutdown", fscb);
  return function release() {
    _signalHandlersEventEmitter.off("gracefulShutdown", gscb);
    _signalHandlersEventEmitter.off("forcefulShutdown", fscb);
    _registeredSignalHandlersCount--;
    if (_registeredSignalHandlersCount === 0) {
      _releaseSignalHandlers();
    }
  };
}

let _releaseSignalHandlers = () => void 0;

function _reallyRegisterSignalHandlers(logger: Logger) {
  const switchToForcefulHandler = () => {
    logger.debug(
      `Switching to forceful handler for termination signals (${SIGNALS.join(
        ", ",
      )}); another termination signal will force a fast (unsafe) shutdown`,
      { switchToForcefulHandlers: true },
    );
    for (const signal of SIGNALS) {
      process.on(signal, forcefulHandler);
      process.removeListener(signal, gracefulHandler);
    }
  };
  const removeForcefulHandler = () => {
    logger.debug(
      `Removed forceful handler for termination signals (${SIGNALS.join(
        ", ",
      )}); another termination signals will likely kill the process (unless you've registered other handlers)`,
      { unregisteringSignalHandlers: true },
    );
    for (const signal of SIGNALS) {
      process.removeListener(signal, forcefulHandler);
    }
  };

  const stdioErrorIgnorer = () => {
    // DO NOTHING. Not even write to `@logger` since that might be using stdio
    // under the hood, and cause recursive errors.
  };
  const stdioErrorHandler = () => {
    process.stdout.on("error", stdioErrorIgnorer);
    process.stdout.off("error", stdioErrorHandler);
    process.stderr.on("error", stdioErrorIgnorer);
    process.stderr.off("error", stdioErrorHandler);

    // Trigger graceful handler
    gracefulHandler("SIGPIPE");
  };

  const gracefulHandler = function (signal: Signal) {
    if (_shuttingDownGracefully || _shuttingDownForcefully) {
      logger.error(
        `Ignoring '${signal}' (graceful shutdown already in progress)`,
      );
      return;
    } else {
      _shuttingDownGracefully = true;
    }

    logger.error(
      `Received '${signal}'; attempting global graceful shutdown... (all termination signals will be ignored for the next 5 seconds)`,
    );
    const switchTimeout = setTimeout(switchToForcefulHandler, 5000);
    _signalHandlersEventEmitter.emit("gracefulShutdown", { signal });

    Promise.allSettled(
      allWorkerPools.map((pool) =>
        pool.gracefulShutdown(`Graceful worker shutdown due to ${signal}`),
      ),
    ).finally(() => {
      clearTimeout(switchTimeout);
      process.removeListener(signal, gracefulHandler);
      if (!_shuttingDownForcefully) {
        logger.error(
          `Global graceful shutdown complete; killing self via ${signal}`,
        );
        process.kill(process.pid, signal);
      }
    });
  };
  const forcefulHandler = function (signal: Signal) {
    if (_shuttingDownForcefully) {
      logger.error(
        `Ignoring '${signal}' (forceful shutdown already in progress)`,
      );
      return;
    } else {
      _shuttingDownForcefully = true;
    }

    logger.error(
      `Received '${signal}'; attempting global forceful shutdown... (all termination signals will be ignored for the next 5 seconds)`,
    );
    const removeTimeout = setTimeout(removeForcefulHandler, 5000);
    _signalHandlersEventEmitter.emit("forcefulShutdown", { signal });

    Promise.allSettled(
      allWorkerPools.map((pool) =>
        pool.forcefulShutdown(`Forced worker shutdown due to ${signal}`),
      ),
    ).finally(() => {
      removeForcefulHandler();
      clearTimeout(removeTimeout);
      logger.error(
        `Global forceful shutdown completed; killing self via ${signal}`,
      );
      process.kill(process.pid, signal);
    });
  };

  logger.debug(
    `Registering termination signal handlers (${SIGNALS.join(", ")})`,
    { registeringSignalHandlers: SIGNALS },
  );

  _registeredSignalHandlers = true;
  for (const signal of SIGNALS) {
    process.on(signal, gracefulHandler);
  }
  process.stdout.on("error", stdioErrorHandler);
  process.stderr.on("error", stdioErrorHandler);
  _releaseSignalHandlers = () => {
    if (_shuttingDownGracefully || _shuttingDownForcefully) {
      logger.warn(`Not unregistering signal handlers as we're shutting down`);
      return;
    }

    _releaseSignalHandlers = () => void 0;
    for (const signal of SIGNALS) {
      process.off(signal, gracefulHandler);
    }
    process.stdout.off("error", stdioErrorHandler);
    process.stderr.off("error", stdioErrorHandler);
    _registeredSignalHandlers = false;
  };
}

export function runTaskList(
  rawOptions: WorkerPoolOptions,
  tasks: TaskList,
  pgPool: Pool,
): WorkerPool {
  const compiledSharedOptions = processSharedOptions(rawOptions);
  return runTaskListInternal(compiledSharedOptions, tasks, pgPool);
}

export function runTaskListInternal(
  compiledSharedOptions: CompiledSharedOptions<WorkerPoolOptions>,
  tasks: TaskList,
  pgPool: Pool,
): WorkerPool {
  const {
    events,
    logger,
    resolvedPreset: {
      worker: { minResetLockedInterval, maxResetLockedInterval },
    },
  } = compiledSharedOptions;
  const withPgClient = makeEnhancedWithPgClient(
    makeWithPgClientFromPool(pgPool),
  );
  const workerPool = _runTaskList(compiledSharedOptions, tasks, withPgClient, {
    continuous: true,
    onTerminate() {
      return resetLockedAtPromise;
    },
    onDeactivate() {
      if (resetLockedTimeout) {
        clearTimeout(resetLockedTimeout);
        resetLockedTimeout = null;
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
      }
      return unlistenForChanges();
    },
  });

  let attempts = 0;
  let reconnectTimeout: NodeJS.Timeout | null = null;
  let changeListener: {
    client: PoolClient;
    release: () => Promise<void>;
  } | null = null;

  const unlistenForChanges = async () => {
    if (changeListener) {
      try {
        await changeListener.release();
      } catch (e) {
        logger.error(
          `Error occurred whilst releasing listening client: ${e.message}`,
          { error: e },
        );
      }
    }
  };

  let resetLockedAtPromise: Promise<void> | undefined;

  const resetLockedDelay = () =>
    Math.ceil(
      minResetLockedInterval +
        Math.random() * (maxResetLockedInterval - minResetLockedInterval),
    );

  const resetLocked = () => {
    resetLockedAtPromise = resetLockedAt(
      compiledSharedOptions,
      withPgClient,
    ).then(
      () => {
        resetLockedAtPromise = undefined;
        if (workerPool._active) {
          const delay = resetLockedDelay();
          events.emit("resetLocked:success", { workerPool, delay });
          resetLockedTimeout = setTimeout(resetLocked, delay);
        } else {
          events.emit("resetLocked:success", { workerPool, delay: null });
        }
      },
      (e) => {
        resetLockedAtPromise = undefined;
        // TODO: push this error out via an event.
        if (workerPool._active) {
          const delay = resetLockedDelay();
          events.emit("resetLocked:failure", {
            workerPool,
            error: e,
            delay,
          });
          resetLockedTimeout = setTimeout(resetLocked, delay);
          logger.error(
            `Failed to reset locked; we'll try again in ${delay}ms`,
            {
              error: e,
            },
          );
        } else {
          events.emit("resetLocked:failure", {
            workerPool,
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
    events.emit("resetLocked:started", { workerPool });
  };

  // Reset locked in the first 60 seconds, not immediately because we don't
  // want to cause a thundering herd.
  let resetLockedTimeout: NodeJS.Timeout | null = setTimeout(
    resetLocked,
    Math.random() * Math.min(60000, maxResetLockedInterval),
  );

  const listenForChanges = (
    err: Error | undefined,
    client: PoolClient,
    releaseClient: () => void,
  ) => {
    if (!workerPool._active) {
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
      try {
        release();
      } catch (e) {
        logger.error(`Error occurred releasing client: ${e.stack}`, {
          error: e,
        });
      }

      reconnectWithExponentialBackoff(e);
    }

    function handleNotification(message: Notification) {
      if (changeListener?.client === client && !workerPool._shuttingDown) {
        events.emit("pool:listen:notification", {
          workerPool,
          message,
          client,
        });
        switch (message.channel) {
          case "jobs:insert": {
            const payload = tryParseJson<{
              count: number;
            }>(message.payload);
            let n = payload?.count ?? 1;
            if (n > 0) {
              // Nudge up to `n` workers
              workerPool._workers.some((worker) => worker.nudge() && --n <= 0);
            }
            break;
          }
          case "worker:migrate": {
            const payload = tryParseJson<{
              migrationNumber?: number;
              breaking?: boolean;
            }>(message.payload);
            if (payload?.breaking) {
              logger.warn(
                `Graphile Worker detected breaking migration to database schema revision '${payload?.migrationNumber}'; it would be unsafe to continue, so shutting down...`,
              );
              process.exitCode = 57;
              workerPool.gracefulShutdown();
            }
            break;
          }
          default: {
            logger.debug(
              `Received NOTIFY message on channel '${message.channel}'`,
            );
          }
        }
      }
    }

    function release() {
      // No need to call changeListener.release() because the client errored
      changeListener = null;
      client.removeListener("notification", handleNotification);
      // TODO: ideally we'd only stop handling errors once all pending queries are complete; but either way we shouldn't try again!
      client.removeListener("error", onErrorReleaseClientAndTryAgain);
      events.emit("pool:listen:release", { workerPool, client });
      return client
        .query('UNLISTEN "jobs:insert"; UNLISTEN "worker:migrate";')
        .catch((error) => {
          /* ignore errors */
          logger.error(`Error occurred attempting to UNLISTEN: ${error}`, {
            error,
          });
        })
        .then(() => releaseClient());
    }

    // On error, release this client and try again
    client.on("error", onErrorReleaseClientAndTryAgain);

    //----------------------------------------

    changeListener = { client, release };
    events.emit("pool:listen:success", { workerPool, client });
    client.on("notification", handleNotification);

    // Subscribe to jobs:insert message
    client.query('LISTEN "jobs:insert"; LISTEN "worker:migrate";').then(() => {
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

  return workerPool;
}

export function _runTaskList(
  compiledSharedOptions: CompiledSharedOptions<
    RunOnceOptions | WorkerPoolOptions
  >,
  tasks: TaskList,
  withPgClient: EnhancedWithPgClient,
  options: {
    concurrency?: number | undefined;
    noHandleSignals?: boolean | undefined;
    continuous: boolean;
    /** If false, you need to call `pool._start()` to start execution */
    autostart?: boolean;
    onDeactivate?: () => Promise<void> | void;
    onTerminate?: () => Promise<void> | void;
  },
): WorkerPool {
  const {
    resolvedPreset: {
      worker: {
        concurrentJobs: baseConcurrency,
        gracefulShutdownAbortTimeout,
        getJobBatchSize = -1,
        completeJobBatchDelay = -1,
        failJobBatchDelay = -1,
      },
    },
    _rawOptions: { noHandleSignals = false },
  } = compiledSharedOptions;
  const {
    concurrency = baseConcurrency,
    continuous,
    autostart: rawAutostart = true,
    onTerminate,
    onDeactivate,
  } = options;
  let autostart = rawAutostart;
  const { logger, events } = compiledSharedOptions;

  if (ENABLE_DANGEROUS_LOGS) {
    logger.debug(
      `Worker pool options are ${inspect(compiledSharedOptions._rawOptions)}`,
      { options: compiledSharedOptions._rawOptions },
    );
  }

  let unregisterSignalHandlers: (() => void) | undefined = undefined;
  if (!noHandleSignals) {
    // Clean up when certain signals occur
    unregisterSignalHandlers = registerSignalHandlers(logger, events);
  }

  const promise = deferred();

  function deactivate() {
    if (workerPool._active) {
      workerPool._active = false;
      return onDeactivate?.();
    }
  }

  let terminated = false;
  function terminate() {
    if (!terminated) {
      terminated = true;
      const idx = allWorkerPools.indexOf(workerPool);
      allWorkerPools.splice(idx, 1);
      promise.resolve(onTerminate?.());
      if (unregisterSignalHandlers) {
        unregisterSignalHandlers();
      }
    } else {
      logger.error(
        `Graphile Worker internal error: terminate() was called twice for worker pool. Ignoring second call; but this indicates a bug - please file an issue.`,
      );
    }
  }

  const abortController = new AbortController();
  const abortSignal = abortController.signal;

  // This is a representation of us that can be interacted with externally
  const workerPool: WorkerPool = {
    // "otpool" - "one time pool"
    id: `${continuous ? "pool" : "otpool"}-${randomBytes(9).toString("hex")}`,
    _active: true,
    _shuttingDown: false,
    _workers: [],
    _withPgClient: withPgClient,
    get worker() {
      return concurrency === 1 ? this._workers[0] ?? null : null;
    },
    abortSignal,
    release: async () => {
      logger.error(
        "DEPRECATED: You are calling `workerPool.release()`; please use `workerPool.gracefulShutdown()` instead.",
      );
      return this.gracefulShutdown();
    },

    /**
     * Stop accepting jobs, and wait gracefully for the jobs that are in
     * progress to complete.
     */
    async gracefulShutdown(
      message = "Worker pool is shutting down gracefully",
    ) {
      if (workerPool._shuttingDown) {
        logger.error(
          `gracefulShutdown called when gracefulShutdown is already in progress`,
        );
        return;
      }
      workerPool._shuttingDown = true;

      const abortTimer = setTimeout(() => {
        abortController.abort();
      }, gracefulShutdownAbortTimeout);
      abortTimer.unref();

      events.emit("pool:gracefulShutdown", {
        pool: workerPool,
        workerPool,
        message,
      });
      try {
        logger.debug(`Attempting graceful shutdown`);
        // Stop new jobs being added
        const deactivatePromise = deactivate();

        // Remove all the workers - we're shutting them down manually
        const workers = [...workerPool._workers];
        const workerPromises = workers.map((worker) => worker.release());
        const [deactivateResult, ...workerReleaseResults] =
          await Promise.allSettled([deactivatePromise, ...workerPromises]);
        if (deactivateResult.status === "rejected") {
          // Log but continue regardless
          logger.error(`Deactivation failed: ${deactivateResult.reason}`, {
            error: deactivateResult.reason,
          });
        }
        const jobsToRelease: Job[] = [];
        for (let i = 0; i < workerReleaseResults.length; i++) {
          const workerReleaseResult = workerReleaseResults[i];
          if (workerReleaseResult.status === "rejected") {
            const worker = workers[i];
            const job = worker.getActiveJob();
            events.emit("pool:gracefulShutdown:workerError", {
              pool: workerPool,
              workerPool,
              error: workerReleaseResult.reason,
              job,
            });
            logger.debug(
              `Cancelling worker ${worker.workerId} (job: ${
                job?.id ?? "none"
              }) failed`,
              {
                worker,
                job,
                reason: workerReleaseResult.reason,
              },
            );
            if (job) {
              jobsToRelease.push(job);
            }
          }
        }
        if (jobsToRelease.length > 0) {
          const workerIds = workers.map((worker) => worker.workerId);
          logger.debug(
            `Releasing the jobs ${jobsToRelease
              .map((j) => j.id)
              .join()} (workers: ${workerIds.join(", ")})`,
            {
              jobs: jobsToRelease,
              workerIds,
            },
          );
          const cancelledJobs = await failJobs(
            compiledSharedOptions,
            withPgClient,
            workerPool.id,
            jobsToRelease,
            message,
          );
          logger.debug(`Cancelled ${cancelledJobs.length} jobs`, {
            cancelledJobs,
          });
        }
        events.emit("pool:gracefulShutdown:complete", {
          pool: workerPool,
          workerPool,
        });
        logger.debug("Graceful shutdown complete");
      } catch (e) {
        events.emit("pool:gracefulShutdown:error", {
          pool: workerPool,
          workerPool,
          error: e,
        });
        logger.error(`Error occurred during graceful shutdown: ${e.message}`, {
          error: e,
        });
        return this.forcefulShutdown(e.message);
      }
      terminate();
    },

    /**
     * Stop accepting jobs and "fail" all currently running jobs.
     */
    async forcefulShutdown(message: string) {
      events.emit("pool:forcefulShutdown", {
        pool: workerPool,
        workerPool,
        message,
      });
      try {
        logger.debug(`Attempting forceful shutdown`);
        // Stop new jobs being added
        const deactivatePromise = deactivate();

        // Release all our workers' jobs
        const workers = [...workerPool._workers];
        const jobsInProgress: Array<Job> = workers
          .map((worker) => worker.getActiveJob())
          .filter((job): job is Job => !!job);

        // Remove all the workers - we're shutting them down manually
        const workerPromises = workers.map((worker) => worker.release(true));
        // Ignore the results, we're shutting down anyway
        // TODO: add a timeout
        const [deactivateResult, ..._ignoreWorkerReleaseResults] =
          await Promise.allSettled([deactivatePromise, ...workerPromises]);
        if (deactivateResult.status === "rejected") {
          // Log but continue regardless
          logger.error(`Deactivation failed: ${deactivateResult.reason}`, {
            error: deactivateResult.reason,
          });
        }

        if (jobsInProgress.length > 0) {
          const workerIds = workers.map((worker) => worker.workerId);
          logger.debug(
            `Releasing the jobs ${jobsInProgress
              .map((j) => j.id)
              .join()} (workers: ${workerIds.join(", ")})`,
            {
              jobs: jobsInProgress,
              workerIds,
            },
          );
          const cancelledJobs = await failJobs(
            compiledSharedOptions,
            withPgClient,
            workerPool.id,
            jobsInProgress,
            message,
          );
          logger.debug(`Cancelled ${cancelledJobs.length} jobs`, {
            cancelledJobs,
          });
        } else {
          logger.debug("No active jobs to release");
        }
        events.emit("pool:forcefulShutdown:complete", {
          pool: workerPool,
          workerPool,
        });
        logger.debug("Forceful shutdown complete");
      } catch (e) {
        events.emit("pool:forcefulShutdown:error", {
          pool: workerPool,
          workerPool,
          error: e,
        });
        logger.error(`Error occurred during forceful shutdown: ${e.message}`, {
          error: e,
        });
      }
      terminate();
    },

    promise,

    then(onfulfilled, onrejected) {
      return promise.then(onfulfilled, onrejected);
    },
    catch(onrejected) {
      return promise.catch(onrejected);
    },
    finally(onfinally) {
      return promise.finally(onfinally);
    },
    _start: autostart
      ? null
      : () => {
          autostart = true;
          workerPool._workers.forEach((worker) => worker._start!());
          workerPool._start = null;
        },
  };

  promise.finally(() => {
    events.emit("pool:release", { pool: workerPool, workerPool });
  });

  abortSignal.addEventListener("abort", () => {
    if (!workerPool._shuttingDown) {
      workerPool.gracefulShutdown();
    }
  });

  // Ensure that during a forced shutdown we get cleaned up too
  allWorkerPools.push(workerPool);
  events.emit("pool:create", { workerPool });

  // Spawn our workers; they can share clients from the pool.
  const workerId =
    "workerId" in compiledSharedOptions._rawOptions
      ? compiledSharedOptions._rawOptions.workerId
      : undefined;
  if (workerId != null && concurrency > 1) {
    throw new Error(
      `You must not set workerId when concurrency > 1; each worker must have a unique identifier`,
    );
  }
  let jobQueue: Job[] = [];
  let nextJobs: Promise<boolean> | null = null;
  let getJobCounter = 0;
  let getJobBaseline = 0;
  const batchGetJob = async (myFetchId: number): Promise<Job | undefined> => {
    if (!nextJobs) {
      // Queue is empty, no fetch of jobs in progress; let's fetch them.
      getJobBaseline = getJobCounter;
      nextJobs = (async () => {
        const jobs = await baseGetJob(
          compiledSharedOptions,
          withPgClient,
          tasks,
          workerPool.id,
          null,
          getJobBatchSize,
        );
        jobQueue = jobs.reverse();
        return jobs.length >= getJobBatchSize;
      })().finally(() => {
        nextJobs = null;
      });
    }
    const fetchedMax = await nextJobs;
    const job = jobQueue.pop();
    if (job) {
      return job;
    } else if (fetchedMax || myFetchId > getJobBaseline) {
      // Either we fetched as many jobs as we could and there still weren't
      // enough, or we requested a job after the request for jobs was sent to
      // the database. Either way, let's fetch again.
      return batchGetJob(myFetchId);
    } else {
      return undefined;
    }
  };
  const getJob: GetJobFunction = async (_workerId, flagsToSkip) => {
    if (flagsToSkip !== null || getJobBatchSize < 1) {
      const jobs = await baseGetJob(
        compiledSharedOptions,
        withPgClient,
        tasks,
        workerPool.id,
        flagsToSkip,
        1,
      );
      return jobs[0];
    } else {
      const job = jobQueue.pop();
      if (job !== undefined) {
        return job;
      } else {
        return batchGetJob(++getJobCounter);
      }
    }
  };

  const completeJob: CompleteJobFunction =
    completeJobBatchDelay >= 0
      ? batch(
          completeJobBatchDelay,
          (job) => job,
          (jobs) =>
            baseCompleteJob(
              compiledSharedOptions,
              withPgClient,
              workerPool.id,
              jobs,
            ),
        )
      : (job) =>
          baseCompleteJob(compiledSharedOptions, withPgClient, workerPool.id, [
            job,
          ]);

  const failJob: FailJobFunction =
    failJobBatchDelay >= 0
      ? batch(
          failJobBatchDelay,
          (job, message, replacementPayload) => ({
            job,
            message,
            replacementPayload,
          }),
          (specs) =>
            baseFailJob(
              compiledSharedOptions,
              withPgClient,
              workerPool.id,
              specs,
            ),
        )
      : (job, message, replacementPayload) =>
          baseFailJob(compiledSharedOptions, withPgClient, workerPool.id, [
            { job, message, replacementPayload },
          ]);

  for (let i = 0; i < concurrency; i++) {
    const worker = makeNewWorker(compiledSharedOptions, {
      tasks,
      withPgClient,
      continuous,
      abortSignal,
      workerPool,
      autostart,
      workerId,
      getJob,
      completeJob,
      failJob,
    });
    workerPool._workers.push(worker);
    const remove = () => {
      if (continuous && workerPool._active && !workerPool._shuttingDown) {
        logger.error(
          `Worker exited, but pool is in continuous mode, is active, and is not shutting down... Did something go wrong?`,
        );
      }
      workerPool._workers.splice(workerPool._workers.indexOf(worker), 1);
      if (!continuous && workerPool._workers.length === 0) {
        deactivate();
        terminate();
      }
    };
    worker.promise.then(
      () => {
        remove();
      },
      (error) => {
        remove();
        console.trace(error);
        logger.error(`Worker exited with error: ${error}`, { error });
      },
    );
  }

  // TODO: handle when a worker shuts down (spawn a new one)

  return workerPool;
}

export const runTaskListOnce = (
  options: RunOnceOptions,
  tasks: TaskList,
  client: PoolClient,
) => {
  const withPgClient = makeEnhancedWithPgClient(
    makeWithPgClientFromClient(client),
  );
  const compiledSharedOptions = processSharedOptions(options);

  const pool = _runTaskList(compiledSharedOptions, tasks, withPgClient, {
    concurrency: 1,
    autostart: false,
    noHandleSignals: options.noHandleSignals,
    continuous: false,
  });

  const resetPromise = resetLockedAt(compiledSharedOptions, withPgClient);

  resetPromise.then(
    () => {
      pool._start!();
    },
    (error) => {
      compiledSharedOptions.logger.error(
        `Error occurred resetting locked at; continuing regardless: ${error}`,
        { error },
      );
      pool._start!();
    },
  );

  return pool;
};

function batch<TArgs extends [...any[]], TSpec, TResult>(
  delay: number,
  makeSpec: (...args: TArgs) => TSpec,
  callback: (specs: ReadonlyArray<TSpec>) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return (...args) => {
    const spec = makeSpec(...args);
    return callback([spec]);
  };
}
