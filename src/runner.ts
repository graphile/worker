import * as assert from "assert";

import { getParsedCronItemsFromOptions, runCron } from "./cron";
import getTasks from "./getTasks";
import { ParsedCronItem, Runner, RunnerOptions, TaskList } from "./interfaces";
import {
  CompiledOptions,
  getUtilsAndReleasersFromOptions,
  Releasers,
} from "./lib";
import { _runTaskList, runTaskList } from "./main";

export const runMigrations = async (options: RunnerOptions): Promise<void> => {
  const { release } = await getUtilsAndReleasersFromOptions(options);
  await release();
};

/** @internal */
async function assertTaskList(
  compiledOptions: CompiledOptions,
  releasers: Releasers,
): Promise<TaskList> {
  const { options } = compiledOptions;
  assert.ok(
    !options.taskDirectory || !options.taskList,
    "Exactly one of either `taskDirectory` or `taskList` should be set",
  );
  if (options.taskList) {
    return options.taskList;
  } else if (options.taskDirectory) {
    const watchedTasks = await getTasks(
      compiledOptions.options,
      options.taskDirectory,
    );
    releasers.push(() => watchedTasks.release());
    return watchedTasks.tasks;
  } else {
    throw new Error(
      "You must specify either `options.taskList` or `options.taskDirectory`",
    );
  }
}

export const runOnce = async (
  options: RunnerOptions,
  overrideTaskList?: TaskList,
): Promise<void> => {
  const compiledOptions = await getUtilsAndReleasersFromOptions(options);
  const { withPgClient, release, releasers } = compiledOptions;
  try {
    const taskList =
      overrideTaskList || (await assertTaskList(compiledOptions, releasers));
    const workerPool = _runTaskList(compiledOptions, taskList, withPgClient, {
      concurrency: options.concurrency ?? 1,
      noHandleSignals: options.noHandleSignals,
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
  const compiledOptions = await getUtilsAndReleasersFromOptions(rawOptions);
  const { release, releasers } = compiledOptions;

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
}): Runner {
  const { compiledOptions, taskList, parsedCronItems } = input;
  const { events, pgPool, releasers, release, addJob, options, logger } =
    compiledOptions;

  const cron = runCron(compiledOptions, parsedCronItems, { pgPool, events });
  releasers.push(() => cron.release());

  const workerPool = runTaskList(options, taskList, pgPool);
  releasers.push(() => {
    if (!workerPool._shuttingDown) {
      return workerPool.gracefulShutdown("Runner is shutting down");
    }
  });

  let running = true;
  const stop = async () => {
    if (running) {
      running = false;
      events.emit("stop", {});
      try {
        await release();
      } catch (error) {
        logger.error(
          `Error occurred whilst attempting to release runner options: ${error.message}`,
          { error },
        );
      }
    } else {
      throw new Error("Runner is already stopped");
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
    addJob,
    promise,
    events,
  };
}
