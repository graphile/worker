import * as assert from "assert";

import { getParsedCronItemsFromOptions, runCron } from "./cron";
import getTasks from "./getTasks";
import {
  ParsedCronItem,
  Runner,
  RunnerOptions,
  TaskList,
  WorkerOptions,
} from "./interfaces";
import {
  CompiledOptions,
  getUtilsAndReleasersFromOptions,
  Releasers,
} from "./lib";
import { runTaskList, runTaskListOnce } from "./main";

export const runMigrations = async (options: RunnerOptions): Promise<void> => {
  const { release } = await getUtilsAndReleasersFromOptions(options);
  await release();
};

async function assertTaskList(
  options: RunnerOptions,
  releasers: Releasers,
): Promise<TaskList> {
  assert.ok(
    !options.taskDirectory || !options.taskList,
    "Exactly one of either `taskDirectory` or `taskList` should be set",
  );
  if (options.taskList) {
    return options.taskList;
  } else if (options.taskDirectory) {
    const watchedTasks = await getTasks(options, options.taskDirectory);
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
  const { concurrency = 1 } = options;
  const { withPgClient, release, releasers } =
    await getUtilsAndReleasersFromOptions(options);
  try {
    const taskList =
      overrideTaskList || (await assertTaskList(options, releasers));

    const promises: Promise<void>[] = [];
    const workerOptions: WorkerOptions = {
      ...options,
      abortSignal: undefined,
    };
    for (let i = 0; i < concurrency; i++) {
      promises.push(
        withPgClient((client) =>
          runTaskListOnce(workerOptions, taskList, client),
        ),
      );
    }
    await Promise.all(promises);
  } finally {
    await release();
  }
};

export const run = async (
  options: RunnerOptions,
  overrideTaskList?: TaskList,
  overrideParsedCronItems?: Array<ParsedCronItem>,
): Promise<Runner> => {
  const compiledOptions = await getUtilsAndReleasersFromOptions(options);
  const { release, releasers } = compiledOptions;

  try {
    const taskList =
      overrideTaskList || (await assertTaskList(options, releasers));

    const parsedCronItems =
      overrideParsedCronItems ||
      (await getParsedCronItemsFromOptions(options, releasers));

    // The result of 'buildRunner' must be returned immediately, so that the
    // user can await its promise property immediately. If this is broken then
    // unhandled promise rejections could occur in some circumstances, causing
    // a process crash in Node v16+.
    return buildRunner({
      options,
      compiledOptions,
      taskList,
      parsedCronItems,
    });
  } catch (e) {
    try {
      await release();
    } catch (e2) {
      console.error(
        `Error occurred whilst attempting to release options after error occurred`,
        e2,
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
  options: RunnerOptions;
  compiledOptions: CompiledOptions;
  taskList: TaskList;
  parsedCronItems: ParsedCronItem[];
}): Runner {
  const { options, compiledOptions, taskList, parsedCronItems } = input;
  const { events, pgPool, releasers, release, addJob } = compiledOptions;

  const cron = runCron(options, parsedCronItems, { pgPool, events });
  releasers.push(() => cron.release());

  const workerPool = runTaskList(options, taskList, pgPool);
  releasers.push(() => {
    if (!workerPool._shuttingDown) {
      workerPool.gracefulShutdown("Runner is shutting down");
    }
  });

  let running = true;
  const stop = async () => {
    if (running) {
      running = false;
      events.emit("stop", {});
      try {
        await release();
      } catch (e) {
        console.error(
          `Error occurred whilst attempting to release runner options`,
          e,
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
    async (e) => {
      if (running) {
        console.error(`Stopping worker due to an error: ${e}`);
        await stop();
      } else {
        console.error(`Error occurred, but worker is already stopping: ${e}`);
      }
      return Promise.reject(e);
    },
  );

  return {
    stop,
    addJob,
    promise,
    events,
  };
}
