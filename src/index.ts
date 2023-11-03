import { AsyncHooks, PluginHook } from "graphile-config";
import type { PoolClient } from "pg";

import getCronItems from "./getCronItems";
import getTasks from "./getTasks";
import {
  FileDetails,
  Task,
  TaskList,
  WithPgClient,
  WorkerEvents,
  WorkerPool,
  Worker,
  SharedOptions,
} from "./interfaces";
import { CompiledSharedOptions } from "./lib";
import { Logger } from "@graphile/logger";
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
  maxMigrationNumber: number;
  breakingMigrationNumbers: number[];
  events: WorkerEvents;
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
  useNodeTime: boolean;
  minResetLockedInterval: number;
  maxResetLockedInterval: number;
  options: SharedOptions;
  hooks: AsyncHooks<GraphileConfig.WorkerHooks>;
  resolvedPreset?: GraphileConfig.ResolvedPreset;
  gracefulShutdownAbortTimeout: number;
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
              ? (ctx: WorkerPluginContext, ...args: UArgs) => UResult
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
      premigrate(event: { readonly client: PoolClient }): PromiseOrDirect<void>;

      /**
       * Called after migrating the DB.
       */
      postmigrate(event: {
        readonly client: PoolClient;
      }): PromiseOrDirect<void>;

      /**
       * Used to build a given `taskIdentifier`'s handler given a list of files,
       * if possible.
       */
      loadTaskFromFiles(event: {
        /**
         * If set, you should not replace this. If unset and you can support
         * this task identifier (see `details`), you should set it.
         */
        handler?: Task;
        /**
         * The string that will identify this task (inferred from the file
         * path).
         */
        readonly taskIdentifier: string;
        /**
         * A list of the files (and associated metadata) that match this task
         * identifier.
         */
        readonly fileDetailsList: readonly FileDetails[];
      }): PromiseOrDirect<void>;

      startWorker(event: {
        readonly worker: Worker;
        flagsToSkip: null | string[];
        readonly tasks: TaskList;
        readonly withPgClient: WithPgClient;
      }): PromiseOrDirect<void>;

      stopWorker(event: {
        readonly worker: Worker;
        readonly withPgClient: WithPgClient;
      }): PromiseOrDirect<void>;
    }
  }
}
