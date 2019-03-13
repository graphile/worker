import { basename } from "path";
import * as chokidar from "chokidar";
import { isValidTask, TaskList, WatchedTaskList } from "./interfaces";
import { tryStat, readdir } from "./fs";
import debug from "./debug";
import { fauxRequire } from "./module";

function validTasks(obj: any) {
  const tasks: TaskList = {};
  Object.keys(obj).forEach(taskName => {
    const task = obj[taskName];
    if (isValidTask(task)) {
      tasks[taskName] = task;
    } else {
      // tslint:disable-next-line no-console
      console.warn(
        `Not a valid task '${taskName}' - expected function, received ${
          task ? typeof task : String(task)
        }.`
      );
    }
  });
}

async function loadFileIntoTasks(
  tasks: any,
  filename: string,
  name: string | null = null,
  watch: boolean = false
) {
  const replacementModule = watch
    ? await fauxRequire(filename)
    : require(filename);

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
        }.`
      );
    }
  } else {
    Object.keys(tasks).forEach(taskName => {
      delete tasks[taskName];
    });
    if (
      !replacementModule.default ||
      typeof replacementModule.default === "function"
    ) {
      Object.assign(tasks, validTasks(replacementModule));
    } else {
      Object.assign(tasks, validTasks(replacementModule.default));
    }
  }
}

export default async function getTasks(
  taskPath: string,
  watch = false
): Promise<WatchedTaskList> {
  const pathStat = await tryStat(taskPath);
  if (!pathStat) {
    throw new Error(
      `Could not find tasks to execute - '${taskPath}' does not exist`
    );
  }

  const watchers: Array<chokidar.FSWatcher> = [];
  let taskNames: Array<string> = [];
  const tasks: TaskList = {};

  const debugSupported = () => {
    const oldTaskNames = taskNames;
    taskNames = Object.keys(tasks).sort();
    if (oldTaskNames.join(",") !== taskNames.join(",")) {
      debug(`Supported task names: '${taskNames.join("', '")}'`);
    }
  };

  if (pathStat.isFile()) {
    if (watch) {
      watchers.push(
        chokidar.watch(taskPath, { ignoreInitial: true }).on("all", () => {
          loadFileIntoTasks(tasks, taskPath, null, watch)
            .then(debugSupported)
            .catch(e => {
              // tslint:disable-next-line no-console
              console.error(`Error in ${taskPath}: ${e.message}`);
            });
        })
      );
    }
    // Try and require it
    await loadFileIntoTasks(tasks, taskPath, null, watch);
  } else if (pathStat.isDirectory()) {
    if (watch) {
      watchers.push(
        chokidar
          .watch(`${taskPath}/*.js`, {
            ignoreInitial: true
          })
          .on("all", (event, eventFilePath) => {
            const taskName = basename(eventFilePath, ".js");
            if (event === "unlink") {
              delete tasks[taskName];
              debugSupported();
            } else {
              loadFileIntoTasks(tasks, eventFilePath, taskName, watch)
                .then(debugSupported)
                .catch(e => {
                  // tslint:disable-next-line no-console
                  console.error(`Error in ${eventFilePath}: ${e.message}`);
                });
            }
          })
      );
    }

    // Try and require its contents
    const files = await readdir(taskPath);
    for (const file of files) {
      if (file.endsWith(".js")) {
        const taskName = file.substr(0, file.length - 3);
        try {
          await loadFileIntoTasks(
            tasks,
            `${taskPath}/${file}`,
            taskName,
            watch
          );
        } catch (e) {
          const message = `Error processing '${taskPath}/${file}': ${
            e.message
          }`;
          if (watch) {
            console.error(message); // tslint:disable-line no-console
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
      watchers.forEach(watcher => watcher.close());
    }
  };
}
