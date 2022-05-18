import * as assert from "assert";

import { getParsedCronItemsFromOptions, runCron } from "./cron";
import getTasks from "./getTasks";
import { ParsedCronItem, Runner, RunnerOptions, TaskList } from "./interfaces";
import { getUtilsAndReleasersFromOptions, Releasers } from "./lib";
import { runTaskList, runTaskListOnce } from "./main";
import { migrate } from "./migrate";

export const runMigrations = async (options: RunnerOptions): Promise<void> => {
  const { withPgClient, release } = await getUtilsAndReleasersFromOptions(
    options,
  );
  try {
    await withPgClient((client) => migrate(options, client));
  } finally {
    await release();
  }
};

async function assertTaskList(
  options: RunnerOptions,
  releasers: Releasers,
): Promise<TaskList> {
  assert(
    !options.taskDirectory || !options.taskList,
    "Exactly one of either `taskDirectory` or `taskList` should be set",
  );
  if (options.taskList) {
    return options.taskList;
  } else if (options.taskDirectory) {
    const watchedTasks = await getTasks(options, options.taskDirectory, false);
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
  const {
    withPgClient,
    release,
    releasers,
  } = await getUtilsAndReleasersFromOptions(options);
  try {
    const taskList =
      overrideTaskList || (await assertTaskList(options, releasers));

    const promises: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) {
      promises.push(
        withPgClient((client) => runTaskListOnce(options, taskList, client)),
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
  const {
    pgPool,
    release,
    releasers,
    addJob,
    events,
  } = await getUtilsAndReleasersFromOptions(options);

  try {
    const taskList =
      overrideTaskList || (await assertTaskList(options, releasers));

    const parsedCronItems =
      overrideParsedCronItems ||
      (await getParsedCronItemsFromOptions(options, releasers));

    // NO AWAIT AFTER THIS POINT! The promise from cron and workerPool must be
    // returned synchronously.

    const cron = runCron(options, parsedCronItems, { pgPool, events });
    releasers.push(() => cron.release());

    const workerPool = runTaskList(options, taskList, pgPool);
    releasers.push(() => workerPool.release());

    let running = true;
    const stop = async () => {
      if (running) {
        running = false;
        events.emit("stop", {});
        await release();
      } else {
        throw new Error("Runner is already stopped");
      }
    };

    const promise = Promise.all([cron.promise, workerPool.promise]).then(
      () => {
        /* void */
      },
      (e) => {
        console.error(`Stopping worker due to an error: ${e}`);
        stop();
        return Promise.reject(e);
      },
    );

    return {
      stop,
      addJob,
      promise,
      events,
    };
  } catch (e) {
    await release();
    throw e;
  }
};
