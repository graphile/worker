import { PluginHook } from "graphile-config";
import type { PoolClient } from "pg";

import getCronItems from "./getCronItems";
import getTasks from "./getTasks";
import { FileDetails, Task } from "./interfaces";
import { CompiledSharedOptions } from "./lib";
export { parseCronItem, parseCronItems, parseCrontab } from "./crontab";
export * from "./interfaces";
export { digestPreset } from "./lib";
export {
  consoleLogFactory,
  LogFunctionFactory,
  Logger,
  LogLevel,
} from "./logger";
export { runTaskList, runTaskListOnce } from "./main";
export { WorkerPreset } from "./preset";
export { run, runMigrations, runOnce } from "./runner";
export { makeWorkerUtils, quickAddJob } from "./workerUtils";

export { getTasks };
export { getCronItems };
export { CompiledSharedOptions };

export interface WorkerPluginContext {
  version: string;
  compiledSharedOptions: CompiledSharedOptions;
}

export type PromiseOrDirect<T> = T | Promise<T>;

declare global {
  namespace GraphileWorker {
    interface Tasks {
      /* extend this through declaration merging */
    }
  }

  namespace GraphileConfig {
    interface WorkerOptions {
      /**
       * Database connection string.
       *
       * @defaultValue `process.env.DATABASE_URL`
       */
      connectionString?: string;
      /**
       * Maximum number of concurrent connections to Postgres
       *
       * @defaultValue `10`
       */
      maxPoolSize?: number;
      /**
       *
       * @defaultValue `2000` */
      pollInterval?: number;
      /** @defaultValue `true` */
      preparedStatements?: boolean;
      /**
       * The database schema in which Graphile Worker is (to be) located.
       *
       * @defaultValue `graphile_worker`
       */
      schema?: string;
      /**
       * Override path to find tasks
       *
       * @defaultValue `process.cwd() + "/tasks"`
       */
      tasksFolder?: string;
      /**
       * Override path to crontab file.
       *
       * @defaultValue `process.cwd() + "/crontab"`
       */
      crontabFile?: string;
      /**
       * Number of jobs to run concurrently.
       *
       * @defaultValue `1`
       */
      concurrentJobs?: number;

      /**
       * A list of file extensions (in priority order) that Graphile Worker
       * should attempt to import directly when loading tasks. Defaults to
       * `[".js", ".cjs", ".mjs"]`.
       */
      fileExtensions?: string[];

      /**
       * How long in milliseconds after a gracefulShutdown is triggered should
       * we wait to trigger the AbortController, which should cancel supported
       * asynchronous actions?
       *
       * @defaultValue `5000`
       */
      gracefulShutdownAbortTimeout?: number;
    }
    interface Preset {
      worker?: WorkerOptions;
    }

    interface Plugin {
      worker?: {
        hooks?: {
          [key in keyof WorkerHooks]?: PluginHook<
            WorkerHooks[key] extends (...args: infer UArgs) => infer UResult
              ? (info: WorkerPluginContext, ...args: UArgs) => UResult
              : never
          >;
        };
      };
    }
    interface WorkerHooks {
      /**
       * Called when Graphile Worker starts up.
       */
      init(): PromiseOrDirect<void>;

      /**
       * Called before migrating the DB.
       */
      premigrate(mutableEvent: { client: PoolClient }): PromiseOrDirect<void>;

      /**
       * Called after migrating the DB.
       */
      postmigrate(mutableEvent: { client: PoolClient }): PromiseOrDirect<void>;

      /**
       * Used to build a given `taskIdentifier`'s handler given a list of files,
       * if possible.
       */
      loadTaskFromFiles(
        mutableEvent: {
          /**
           * If set, you should not replace this. If unset and you can support
           * this task identifier (see `details`), you should set it.
           */
          handler?: Task;
        },
        details: {
          /**
           * The string that will identify this task (inferred from the file
           * path).
           */
          taskIdentifier: string;
          /**
           * A list of the files (and associated metadata) that match this task
           * identifier.
           */
          fileDetailsList: readonly FileDetails[];
        },
      ): PromiseOrDirect<void>;
    }
  }
}
