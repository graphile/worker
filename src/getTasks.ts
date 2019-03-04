import * as rawFs from "fs";
import { promisify } from "util";
import { dirname, basename } from "path";
import * as chokidar from "chokidar";
import { Task, TaskList, WatchedTaskList } from "./interfaces";
import m = require("module");

const { Module } = m;

const stat = promisify(rawFs.stat);
const readFile = promisify(rawFs.readFile);
const readdir = promisify(rawFs.readdir);

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

function ensureValidTask(fn: any): fn is Task {
  if (typeof fn === "function") {
    return true;
  }
  return false;
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

  if (name) {
    tasks[name] = ensureValidTask(
      replacementModule.exports.default || replacementModule.exports
    );
  }

  return replacementModule.exports;
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
  const tasks: TaskList = {};
  if (pathStat.isFile()) {
    if (watch) {
      watchers.push(
        chokidar.watch(taskPath).on("all", event => {
          console.log(event, taskPath);
          loadFileIntoTasks(tasks, taskPath).catch(e => {
            // tslint:disable-next-line no-console
            console.error(
              `Error loading updated tasks file ${taskPath}: ${e.message}`
            );
          });
        })
      );
    }
    // Try and require it
    await loadFileIntoTasks(tasks, taskPath);
  } else if (pathStat.isDirectory()) {
    if (watch) {
      watchers.push(
        chokidar.watch(`${taskPath}/*.js`).on("all", (event, eventFilePath) => {
          const taskName = basename(taskPath, ".js");
          console.log(event, eventFilePath, taskName);
          if (event === "unlink") {
            delete tasks[taskName];
          } else {
            loadFileIntoTasks(tasks, eventFilePath, taskName).catch(e => {
              // tslint:disable-next-line no-console
              console.error(
                `Error loading updated tasks file ${taskPath}: ${e.message}`
              );
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
        await loadFileIntoTasks(tasks, `${taskPath}/${file}`, taskName);
      }
    }
  }

  return {
    tasks,
    release: () => {
      watchers.forEach(watcher => watcher.close());
    }
  };
}
