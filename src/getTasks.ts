import { Stats } from "fs";
import { lstat, readdir, realpath } from "fs/promises";
import { join as pathJoin } from "path";

import { tryStat } from "./fs";
import {
  isValidTask,
  SharedOptions,
  TaskList,
  WatchedTaskList,
} from "./interfaces";
import { FileDetails } from "./interfaces.js";
import { CompiledSharedOptions, processSharedOptions } from "./lib";
import { Logger } from "./logger";

const DIRECTORY_REGEXP = /^[A-Za-z0-9_-]+$/;
const FILE_REGEXP = /^([A-Za-z0-9_-]+)((?:\.[A-Za-z0-9_-]+)*)$/;

function validTasks(
  logger: Logger,
  obj: { [taskIdentifier: string]: unknown },
): TaskList {
  const tasks: TaskList = {};
  Object.keys(obj).forEach((taskIdentifier) => {
    const task = obj[taskIdentifier];
    if (isValidTask(task)) {
      tasks[taskIdentifier] = task;
    } else {
      logger.warn(
        `Not a valid task '${taskIdentifier}' - expected function, received ${
          task ? typeof task : String(task)
        }.`,
        {
          invalidTask: true,
          task,
          taskIdentifier,
        },
      );
    }
  });
  return tasks;
}

async function loadFileIntoTasks(
  logger: Logger,
  tasks: { [taskIdentifier: string]: unknown },
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
    Object.keys(tasks).forEach((taskIdentifier) => {
      delete tasks[taskIdentifier];
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
  const compiledSharedOptions = processSharedOptions(options);
  const { logger } = compiledSharedOptions;
  const pathStat = await tryStat(taskPath);
  if (!pathStat) {
    throw new Error(
      `Could not find tasks to execute - taskDirectory '${taskPath}' does not exist`,
    );
  }

  const tasks: TaskList = Object.create(null);

  if (pathStat.isFile()) {
    // Try and require it
    await loadFileIntoTasks(logger, tasks, taskPath, null);
  } else if (pathStat.isDirectory()) {
    const collectedTaskPaths: Record<string, FileDetails[]> =
      Object.create(null);
    await getTasksFromDirectory(
      compiledSharedOptions,
      collectedTaskPaths,
      taskPath,
      [],
    );

    const taskIdentifiers = Object.keys(collectedTaskPaths).sort((a, z) =>
      a.localeCompare(z, "en-US"),
    );

    for (const taskIdentifier of taskIdentifiers) {
      const fileDetailsList = collectedTaskPaths[taskIdentifier];
      const event: Parameters<
        GraphileConfig.WorkerHooks["loadTaskFromFiles"]
      >[0] = {
        handler: undefined,
        taskIdentifier,
        fileDetailsList,
      };
      await compiledSharedOptions.hooks.process("loadTaskFromFiles", event);
      const handler = event.handler;
      if (handler) {
        tasks[taskIdentifier] = handler;
      } else {
        logger.warn(
          `Failed to load task '${taskIdentifier}' - no supported handlers found for path${
            fileDetailsList.length > 1 ? "s" : ""
          }: '${fileDetailsList.map((d) => d.fullPath).join("', '")}'`,
        );
      }
    }
  }

  let released = false;
  return {
    tasks,
    compiledSharedOptions,
    release: () => {
      if (released) {
        return;
      }
      released = true;
    },
  };
}

async function getTasksFromDirectory(
  compiledSharedOptions: CompiledSharedOptions,
  collectedTaskPaths: Record<string, FileDetails[]>,
  taskPath: string,
  subpath: string[],
): Promise<void> {
  const { logger } = compiledSharedOptions;
  const folderPath = pathJoin(taskPath, ...subpath);
  // Try and require its contents
  const entries = await readdir(folderPath);
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = pathJoin(taskPath, ...subpath, entry);
      const stats = await lstat(fullPath);
      if (stats.isDirectory()) {
        if (DIRECTORY_REGEXP.test(entry)) {
          await getTasksFromDirectory(
            compiledSharedOptions,
            collectedTaskPaths,
            taskPath,
            [...subpath, entry],
          );
        } else {
          logger.info(
            `Ignoring directory '${fullPath}' - '${entry}' does not match allowed regexp.`,
          );
        }
      } else if (stats.isSymbolicLink()) {
        // Must be a symbolic link to a file, otherwise ignore
        const symlinkTarget = await realpath(fullPath);
        const targetStats = await lstat(symlinkTarget);
        if (targetStats.isFile() && !targetStats.isSymbolicLink()) {
          maybeAddFile(
            compiledSharedOptions,
            collectedTaskPaths,
            subpath,
            entry,
            symlinkTarget,
            targetStats,
          );
        }
      } else if (stats.isFile()) {
        maybeAddFile(
          compiledSharedOptions,
          collectedTaskPaths,
          subpath,
          entry,
          fullPath,
          stats,
        );
      }
    }),
  );
}

function maybeAddFile(
  compiledSharedOptions: CompiledSharedOptions,
  collectedTaskPaths: Record<string, FileDetails[]>,
  subpath: string[],
  entry: string,
  fullPath: string,
  stats: Stats,
) {
  const { logger } = compiledSharedOptions;
  const matches = FILE_REGEXP.exec(entry);

  if (matches) {
    const [, baseName, extension] = matches;
    const entry: FileDetails = {
      fullPath,
      stats,
      baseName,
      extension,
    };
    const taskIdentifier = [...subpath, baseName].join("/");
    if (!collectedTaskPaths[taskIdentifier]) {
      collectedTaskPaths[taskIdentifier] = [entry];
    } else {
      collectedTaskPaths[taskIdentifier].push(entry);
    }
  } else {
    logger.info(
      `Ignoring file '${fullPath}' - '${entry}' does not match allowed regexp.`,
    );
  }
}
