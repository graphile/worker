import { dirname, basename } from "path";
import * as chokidar from "chokidar";
import debugFactory from "debug";
import { Task, TaskList, WatchedTaskList } from "./interfaces";
import m = require("module");
import { stat, readFile, readdir } from "./fs";

const { Module } = m;
const debug = debugFactory("graphile-worker");

async function tryStat(pathToStat: string) {
  try {
    return await stat(pathToStat);
  } catch (e) {
    return null;
  }
}

function stripBOM(str: string) {
  if (str.charCodeAt(0) === 0xfeff) {
    return str.slice(1);
  }
  return str;
}

function isValidTask(fn: any): fn is Task {
  if (typeof fn === "function") {
    return true;
  }
  return false;
}

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

/**
 * This function emulates the behaviour of `require()`, enabling us to call it
 * multiple times without worrying about having to clear out the cache (useful
 * for watch mode).
 */
async function loadFileIntoTasks(
  tasks: any,
  filename: string,
  name: string | null = null
) {
  const contents = await readFile(filename, "utf8");

  const code = stripBOM(contents);

  // Construct the module
  const replacementModule = new Module(filename, this);
  // And initialise it:
  // Ref: https://github.com/nodejs/node/blob/eb6741b15ebd93ffdd71e87cbc1350b9e94ef222/lib/internal/modules/cjs/loader.js#L616
  replacementModule.filename = filename;

  /*
   * This is naughty - we're using the Node internals. We should probably
   * instead duplicate the code here like @std/esm does:
   *
   * https://github.com/standard-things/esm/issues/66
   * https://github.com/standard-things/esm/blob/16035f6d25fdafb921a49401c7693a863cc14f81/src/module/static/node-module-paths.js
   * https://github.com/standard-things/esm/blob/16035f6d25fdafb921a49401c7693a863cc14f81/src/module/internal/load.js
   */
  // @ts-ignore
  replacementModule.paths = Module._nodeModulePaths(dirname(filename));
  // @ts-ignore
  replacementModule._compile(code, filename);

  replacementModule.loaded = true;

  if (!replacementModule.exports) {
    throw new Error(`Module '${filename}' doesn't have an export`);
  }

  if (name) {
    const task = replacementModule.exports.default || replacementModule.exports;
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
      !replacementModule.exports.default ||
      typeof replacementModule.exports.default === "function"
    ) {
      Object.assign(tasks, validTasks(replacementModule.exports));
    } else {
      Object.assign(tasks, validTasks(replacementModule.exports.default));
    }
  }
}

export async function getTasks(
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
        chokidar.watch(taskPath).on("all", () => {
          loadFileIntoTasks(tasks, taskPath)
            .then(debugSupported)
            .catch(e => {
              // tslint:disable-next-line no-console
              console.error(`Error in ${taskPath}: ${e.message}`);
            });
        })
      );
    }
    // Try and require it
    await loadFileIntoTasks(tasks, taskPath);
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
              loadFileIntoTasks(tasks, eventFilePath, taskName)
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
          await loadFileIntoTasks(tasks, `${taskPath}/${file}`, taskName);
        } catch (e) {
          const message = `Error processing '${taskPath}/${file}': ${
            e.message
          }`;
          if (watch) {
            // tslint:disable-next-line no-console
            console.error(message);
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
