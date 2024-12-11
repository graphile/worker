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
  const stop = async () => {
    compiledOptions.logger.debug("Runner stopping");
    if (running) {
      running = false;
      events.emit("stop", { ctx });
      try {
        const promises: Array<PromiseOrDirect<void>> = [];
        if (cron._active) {
          promises.push(cron.release());
        }
        if (workerPool._active) {
          promises.push(workerPool.gracefulShutdown());
        }
        await Promise.all(promises).then(release);
      } catch (error) {
        logger.error(
          `Error occurred whilst attempting to release runner options: ${
            coerceError(error).message
          }`,
          { error },
        );
      }
    } else {
      throw new Error("Runner is already stopped");
    }
  };
  const kill = async () => {
    if (running) {
      stop().catch(() => {});
    }
    if (workerPool._active) {
      await workerPool.forcefulShutdown(`Terminated through .kill() command`);
    }
  };

  workerPool.promise.finally(() => {
    if (running) {
      stop();
    }
  });
  cron.promise.finally(() => {
    if (running) {
      stop();
    }
  });

  const promise = Promise.all([cron.promise, workerPool.promise]).then(
    () => {
      /* noop */
    },
    async (error) => {
      if (running) {
        logger.error(`Stopping worker due to an error: ${error}`, { error });
        await stop();
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
    stop,
    kill,
    addJob,
    promise,
    events,
  };
}
