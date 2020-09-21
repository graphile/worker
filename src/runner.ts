import * as assert from "assert";

import getTasks from "./getTasks";
import { Runner, RunnerOptions, TaskList } from "./interfaces";
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
  let taskList: TaskList;
  assert(
    !options.taskDirectory || !options.taskList,
    "Exactly one of either `taskDirectory` or `taskList` should be set",
  );
  if (options.taskList) {
    taskList = options.taskList;
  } else if (options.taskDirectory) {
    const watchedTasks = await getTasks(options, options.taskDirectory, false);
    releasers.push(() => watchedTasks.release());
    taskList = watchedTasks.tasks;
  } else {
    throw new Error(
      "You must specify either `options.taskList` or `options.taskDirectory`",
    );
  }
  return taskList;
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
): Promise<Runner> => {
  const {
    pgPool,
    release,
    releasers,
    addJob,
  } = await getUtilsAndReleasersFromOptions(options);

  try {
    const taskList =
      overrideTaskList || (await assertTaskList(options, releasers));

    const workerPool = runTaskList(options, taskList, pgPool);
    releasers.push(() => workerPool.release());

    let running = true;
    return {
      async stop() {
        if (running) {
          running = false;
          await release();
        } else {
          throw new Error("Runner is already stopped");
        }
      },
      addJob,
      promise: workerPool.promise,
    };
  } catch (e) {
    await release();
    throw e;
  }
};
