import { readdir, tryStat } from "./fs";
import {
  isValidTask,
  SharedOptions,
  TaskList,
  WatchedTaskList,
} from "./interfaces";
import { processSharedOptions } from "./lib";
import { Logger } from "./logger";

function validTasks(
  logger: Logger,
  obj: { [taskName: string]: unknown },
): TaskList {
  const tasks: TaskList = {};
  Object.keys(obj).forEach((taskName) => {
    const task = obj[taskName];
    if (isValidTask(task)) {
      tasks[taskName] = task;
    } else {
      logger.warn(
        `Not a valid task '${taskName}' - expected function, received ${
          task ? typeof task : String(task)
        }.`,
        {
          invalidTask: true,
          task,
          taskName,
        },
      );
    }
  });
  return tasks;
}

async function loadFileIntoTasks(
  logger: Logger,
  tasks: { [taskName: string]: unknown },
  filename: string,
  name: string | null = null,
) {
  const rawMod = await import(filename);
  const mod =
    Object.keys(rawMod).length === 1 &&
    typeof rawMod.default === "object" &&
    rawMod.default !== null
      ? rawMod.default
      : rawMod;

  if (name) {
    const task = mod.default || mod;
    if (isValidTask(task)) {
      tasks[name] = task;
    } else {
      throw new Error(
        `Invalid task '${name}' - expected function, received ${
          task ? typeof task : String(task)
        }.`,
      );
    }
  } else {
    Object.keys(tasks).forEach((taskName) => {
      delete tasks[taskName];
    });
    if (!mod.default || typeof mod.default === "function") {
      Object.assign(tasks, validTasks(logger, mod));
    } else {
      Object.assign(tasks, validTasks(logger, mod.default));
    }
  }
}

export default async function getTasks(
  options: SharedOptions,
  taskPath: string,
): Promise<WatchedTaskList> {
  const { logger } = processSharedOptions(options);
  const pathStat = await tryStat(taskPath);
  if (!pathStat) {
    throw new Error(
      `Could not find tasks to execute - '${taskPath}' does not exist`,
    );
  }

  const tasks: TaskList = {};

  if (pathStat.isFile()) {
    // Try and require it
    await loadFileIntoTasks(logger, tasks, taskPath, null);
  } else if (pathStat.isDirectory()) {
    // Try and require its contents
    const files = await readdir(taskPath);
    for (const file of files) {
      if (file.endsWith(".js")) {
        const taskName = file.slice(0, -3);
        try {
          await loadFileIntoTasks(
            logger,
            tasks,
            `${taskPath}/${file}`,
            taskName,
          );
        } catch (error) {
          const message = `Error processing '${taskPath}/${file}': ${error.message}`;
          throw new Error(message);
        }
      }
    }
  }

  let released = false;
  return {
    tasks,
    release: () => {
      if (released) {
        return;
      }
      released = true;
    },
  };
}
