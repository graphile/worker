import { getParsedCronItemsFromOptions, runCron } from "./cron";
import { getTasksInternal } from "./getTasks";
import {
  ParsedCronItem,
  PromiseOrDirect,
  Runner,
  RunnerOptions,
  TaskList,
  WorkerPluginContext,
} from "./interfaces";
import {
  coerceError,
  CompiledOptions,
  getUtilsAndReleasersFromOptions,
  Releasers,
  sleep,
} from "./lib";
import { _runTaskList, runTaskListInternal } from "./main";

export const runMigrations = async (options: RunnerOptions): Promise<void> => {
  const [, release] = await getUtilsAndReleasersFromOptions(options);
  await release();
};

/** @internal */
async function assertTaskList(
  compiledOptions: CompiledOptions,
  releasers: Releasers,
): Promise<TaskList> {
  const {
    resolvedPreset: {
      worker: { taskDirectory },
    },
    _rawOptions: { taskList },
  } = compiledOptions;
  if (taskList) {
    return taskList;
  } else if (taskDirectory) {
    const watchedTasks = await getTasksInternal(compiledOptions, taskDirectory);
    releasers.push(() => watchedTasks.release());
    return watchedTasks.tasks;
  } else {
    throw new Error("You must specify either `taskList` or `taskDirectory`");
  }
}

export const runOnce = async (
  options: RunnerOptions,
  overrideTaskList?: TaskList,
): Promise<void> => {
  const [compiledOptions, release] = await getUtilsAndReleasersFromOptions(
    options,
  );
  return runOnceInternal(compiledOptions, overrideTaskList, release);
};

export const runOnceInternal = async (
  compiledOptions: CompiledOptions,
  overrideTaskList: TaskList | undefined,
  release: () => PromiseOrDirect<void>,
): Promise<void> => {
  const {
    withPgClient,
    releasers,
    resolvedPreset: {
      worker: { concurrentJobs: concurrency },
    },
    _rawOptions: { noHandleSignals },
  } = compiledOptions;
  try {
    const taskList =
      overrideTaskList || (await assertTaskList(compiledOptions, releasers));
    const workerPool = _runTaskList(compiledOptions, taskList, withPgClient, {
      concurrency,
      noHandleSignals,
      continuous: false,
    });

    return await workerPool.promise;
  } finally {
    await release();
  }
};

export const run = async (
  rawOptions: RunnerOptions,
  overrideTaskList?: TaskList,
  overrideParsedCronItems?: Array<ParsedCronItem>,
): Promise<Runner> => {
  const [compiledOptions, release] = await getUtilsAndReleasersFromOptions(
    rawOptions,
  );
  return runInternal(
    compiledOptions,
    overrideTaskList,
    overrideParsedCronItems,
    release,
  );
};

export const runInternal = async (
  compiledOptions: CompiledOptions,
  overrideTaskList: TaskList | undefined,
  overrideParsedCronItems: Array<ParsedCronItem> | undefined,
  release: () => PromiseOrDirect<void>,
): Promise<Runner> => {
  const { releasers } = compiledOptions;

  try {
    const taskList =
      overrideTaskList || (await assertTaskList(compiledOptions, releasers));

    const parsedCronItems =
      overrideParsedCronItems ||
      (await getParsedCronItemsFromOptions(compiledOptions, releasers));

    // The result of 'buildRunner' must be returned immediately, so that the
    // user can await its promise property immediately. If this is broken then
    // unhandled promise rejections could occur in some circumstances, causing
    // a process crash in Node v16+.
    return buildRunner({
      compiledOptions,
      taskList,
      parsedCronItems,
      release,
    });
  } catch (e) {
    try {
      await release();
    } catch (e2) {
      compiledOptions.logger.error(
        `Error occurred whilst attempting to release options after error occurred`,
        { error: e, secondError: e2 },
      );
    }
    throw e;
  }
};

/**
 * This _synchronous_ function exists to ensure that the promises are built and
 * returned synchronously, such that an unhandled promise rejection error does
 * not have time to occur.
 *
 * @internal
 */
function buildRunner(input: {
  compiledOptions: CompiledOptions;
  taskList: TaskList;
  parsedCronItems: ParsedCronItem[];
  release: () => PromiseOrDirect<void>;
}): Runner {
  const { compiledOptions, taskList, parsedCronItems, release } = input;
  const ctx: WorkerPluginContext = compiledOptions;
  const { events, pgPool, releasers, addJob, logger } = compiledOptions;

  const cron = runCron(compiledOptions, parsedCronItems, { pgPool, events });
  releasers.push(() => cron.release());

  const workerPool = runTaskListInternal(compiledOptions, taskList, pgPool);
  releasers.push(() => {
    if (!workerPool._shuttingDown) {
      return workerPool.gracefulShutdown("Runner is shutting down");
    }
  });

  let running = true;
  const stop = (
    reason: string | null,
    itsFine = reason === null,
  ): Promise<void> => {
    compiledOptions.logger[itsFine ? "debug" : "warn"](
      `Runner stopping${reason ? ` (reason: ${reason})` : ""}`,
    );
    if (running) {
      running = false;
      const promises: Array<PromiseOrDirect<void>> = [];
      // Wrap in async IIFE to capture synchronous errors
      promises.push((async () => void events.emit("stop", { ctx }))());
      if (cron._active) {
        promises.push((async () => cron.release())());
      }
      if (workerPool._active) {
        promises.push((async () => workerPool.gracefulShutdown())());
      }
      return Promise.all(promises).then(
        () => release(),
        (error) => {
          logger.error(
            `Error occurred whilst attempting to release runner options: ${
              coerceError(error).message
            }`,
            { error },
          );
        },
      );
    } else {
      return Promise.reject(new Error("Runner is already stopped"));
    }
  };

  const wp = workerPool.promise
    .then(
      () => (running ? stop("worker pool exited cleanly", true) : void 0),
      (e) => (running ? stop(`worker pool exited with error: ${e}`) : void 0),
    )
    .catch(noop);
  const cp = cron.promise
    .then(
      () => (running ? stop("cron exited cleanly", true) : void 0),
      (e) => (running ? stop(`cron exited with error: ${e}`) : void 0),
    )
    .catch(noop);

  const promise = Promise.all([cp, wp]).then(
    () => {
      /* noop */
    },
    async (error) => {
      if (running) {
        logger.error(`Stopping worker due to an error: ${error}`, { error });
        await stop(String(error));
      } else {
        logger.error(
          `Error occurred, but worker is already stopping: ${error}`,
          { error },
        );
      }
      return Promise.reject(error);
    },
  );

  return {
    // It's fine - the user told us to exit
    stop: (reason) => stop(reason ?? null, true),
    async kill(reason?: string) {
      if (running) {
        stop(`runner.kill() called${reason ? `: ${reason}` : ""}`).catch(noop);
      }
      if (workerPool._active) {
        // `stop()` will already have triggered gracefulShutdown, we'll
        // go forceful after a short delay
        await sleep(500);
        if (workerPool._active) {
          await workerPool.forcefulShutdown(
            `Terminated through .kill() command`,
          );
        }
      }
    },
    addJob,
    promise,
    events,
  };
}

function noop() {
  /* NOOP */
}
