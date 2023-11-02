import { spawn } from "child_process";
import { constants } from "fs";
import { GraphileConfig } from "graphile-config";

import { Task } from "../index.js";
import { version } from "../version.js";

const supportsExecutableBit = [
  "darwin",
  "freebsd",
  "linux",
  "openbsd",
  "sunos",
].includes(process.platform);

export const LoadTaskFromExecutableFilePlugin: GraphileConfig.Plugin = {
  name: "LoadTaskFromExecutableFilePlugin",
  version,

  worker: {
    hooks: {
      init(ctx) {
        if (!supportsExecutableBit) {
          ctx.logger.warn(
            `Executable file detection not yet supported on '${process.platform}'.`,
          );
        }
      },
      async loadTaskFromFiles(ctx, mutableEvent, details) {
        // Check it hasn't already been handled
        if (mutableEvent.handler) {
          return;
        }

        // Return if OS is unsupported
        if (!supportsExecutableBit) {
          return;
        }

        const { fileDetailsList, taskIdentifier } = details;

        // We ought to do 'fs.accessSync(p, fs.constants.X_OK)', but this seems
        // excessive. Let's just look at the owner mode.
        const executableFile = fileDetailsList.find(
          (f) => f.stats.mode & constants.S_IXUSR,
        );
        if (!executableFile) {
          // Don't know how to handle; skip
          return;
        }

        ctx.logger.debug(
          `Making executable file task '${taskIdentifier}' for '${executableFile.fullPath}'`,
          { executableFile },
        );
        mutableEvent.handler = makeTaskForExecutable(
          taskIdentifier,
          executableFile.fullPath,
        );
      },
    },
  },
};

function makeTaskForExecutable(taskIdentifier: string, fullPath: string): Task {
  return (payload, helpers) => {
    return new Promise((resolve, reject) => {
      const child = spawn(fullPath, [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // This allows us to add more formats in future
          GRAPHILE_WORKER_PAYLOAD_FORMAT: "json",
          GRAPHILE_WORKER_TASK_IDENTIFIER: taskIdentifier,
          GRAPHILE_WORKER_JOB_ID: helpers.job.id,
          GRAPHILE_WORKER_JOB_KEY: helpers.job.key ?? undefined,
          GRAPHILE_WORKER_JOB_ATTEMPTS: String(helpers.job.attempts),
          GRAPHILE_WORKER_JOB_MAX_ATTEMPTS: String(helpers.job.max_attempts),
          GRAPHILE_WORKER_JOB_PRIORITY: String(helpers.job.priority),
          GRAPHILE_WORKER_JOB_RUN_AT: helpers.job.run_at.toISOString(),
        },
        stdio: "pipe",
        shell: false,
        signal: helpers.abortSignal,
        timeout: 4 * 60 * 60 * 1000, // 4 hours
      });
      child.once("error", (error) => {
        reject(error);
      });
      child.on("stdout", (data) => {
        helpers.logger.info(data.toString("utf8"));
      });
      child.on("stderr", (data) => {
        helpers.logger.error(data.toString("utf8"));
      });
      child.once("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(`Process exited with code ${code}`);
        }
      });
      child.stdin.end(JSON.stringify({ payload }));
    });
  };
}
