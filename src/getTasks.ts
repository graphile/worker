import * as chokidar from "chokidar";
import { basename } from "path";

import { readdir, tryStat } from "./fs";
import {
  isValidTask,
  SharedOptions,
  TaskList,
  WatchedTaskList,
} from "./interfaces";
import { processSharedOptions } from "./lib";
import { Logger } from "./logger";
import { fauxRequire } from "./module";

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
  watch: boolean = false,
) {
  const replacementModule = watch ? fauxRequire(filename) : require(filename);

  if (!replacementModule) {
    throw new Error(`Module '${filename}' doesn't have an export`);
  }

  if (name) {
    const task = replacementModule.default || replacementModule;
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
    if (
      !replacementModule.default ||
      typeof replacementModule.default === "function"
    ) {
      Object.assign(tasks, validTasks(logger, replacementModule));
    } else {
      Object.assign(tasks, validTasks(logger, replacementModule.default));
    }
  }
}

export default async function getTasks(
  options: SharedOptions,
  taskPath: string,
  watch = false,
): Promise<WatchedTaskList> {
  const { logger } = await processSharedOptions(options);
  const pathStat = await tryStat(taskPath);
  if (!pathStat) {
    throw new Error(
      `Could not find tasks to execute - '${taskPath}' does not exist`,
    );
  }

  const watchers: Array<chokidar.FSWatcher> = [];
  let taskNames: Array<string> = [];
  const tasks: TaskList = {};

  const debugSupported = (debugLogger = logger) => {
    const oldTaskNames = taskNames;
    taskNames = Object.keys(tasks).sort();
    if (oldTaskNames.join(",") !== taskNames.join(",")) {
      debugLogger.debug(`Supported task names: '${taskNames.join("', '")}'`, {
        taskNames,
      });
    }
  };

  const watchLogger = logger.scope({ label: "watch" });
  if (pathStat.isFile()) {
    if (watch) {
      watchers.push(
        chokidar.watch(taskPath, { ignoreInitial: true }).on("all", () => {
          loadFileIntoTasks(watchLogger, tasks, taskPath, null, watch)
            .then(() => debugSupported(watchLogger))
            .catch((error) => {
              watchLogger.error(`Error in ${taskPath}: ${error.message}`, {
                taskPath,
                error,
              });
            });
        }),
      );
    }
    // Try and require it
    await loadFileIntoTasks(logger, tasks, taskPath, null, watch);
  } else if (pathStat.isDirectory()) {
    if (watch) {
      watchers.push(
        chokidar
          .watch(`${taskPath}/*.js`, {
            ignoreInitial: true,
          })
          .on("all", (event, eventFilePath) => {
            const taskName = basename(eventFilePath, ".js");
            if (event === "unlink") {
              delete tasks[taskName];
              debugSupported(watchLogger);
            } else {
              loadFileIntoTasks(
                watchLogger,
                tasks,
                eventFilePath,
                taskName,
                watch,
              )
                .then(() => debugSupported(watchLogger))
                .catch((error) => {
                  watchLogger.error(
                    `Error in ${eventFilePath}: ${error.message}`,
                    { eventFilePath, error },
                  );
                });
            }
          }),
      );
    }

    // Try and require its contents
    const files = await readdir(taskPath);
    for (const file of files) {
      if (file.endsWith(".js")) {
        const taskName = file.substr(0, file.length - 3);
        try {
          await loadFileIntoTasks(
            logger,
            tasks,
            `${taskPath}/${file}`,
            taskName,
            watch,
          );
        } catch (error) {
          const message = `Error processing '${taskPath}/${file}': ${error.message}`;
          if (watch) {
            watchLogger.error(message, { error });
          } else {
            throw new Error(message);
          }
        }
      }
    }
  }

  taskNames = Object.keys(tasks).sort();
  return {
    tasks,
    release: () => {
      watchers.forEach((watcher) => watcher.close());
    },
  };
}
