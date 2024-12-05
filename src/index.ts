import { Logger } from "@graphile/logger";
import { PluginHook } from "graphile-config";
import type { PoolClient } from "pg";

import { getCronItems } from "./getCronItems";
import { getTasks } from "./getTasks";
import {
  FileDetails,
  PromiseOrDirect,
  Task,
  TaskList,
  WithPgClient,
  Worker,
  WorkerEvents,
  WorkerPluginContext,
} from "./interfaces";
import { CompiledSharedOptions } from "./lib";
export { parseCronItem, parseCronItems, parseCrontab } from "./crontab";
export * from "./interfaces";
export {
  consoleLogFactory,
  LogFunctionFactory,
  Logger,
  LogLevel,
} from "./logger";
export { runTaskList, runTaskListOnce } from "./main";
export { WorkerPreset } from "./preset";
export { run, runMigrations, runOnce } from "./runner";
export { addJobAdhoc, makeWorkerUtils, quickAddJob } from "./workerUtils";

export { getTasks };
export { getCronItems };
export { CompiledSharedOptions };

declare global {
  namespace GraphileWorker {
    interface Tasks {
      /* extend this through declaration merging */
    }
    interface MigrateEvent {
      /**
       * The client used to run the migration. Replacing this is not officially
       * supported, but...
       */
      client: PoolClient;
      /**
       * The Postgres version number, e.g. 120000 for PostgreSQL 12.0
       */
      readonly postgresVersion: number;
      /**
       * Somewhere to store temporary data from plugins, only used during
       * premigrate, postmigrate, prebootstrap and postbootstrap
       */
      readonly scratchpad: Record<string, unknown>;
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
       * Maximum number of concurrent connections to Postgres. Must be at least `2`.
       *
       * @defaultValue `10`
       */
      maxPoolSize?: number;
      /**
       *
       * @defaultValue `2000` */
      pollInterval?: number;
      /**
       * Whether Graphile Worker should use prepared statements. Set to `false` for
       * compatibility with pgBouncer < 1.21.0.
       *
       * @defaultValue `true`
       */
      preparedStatements?: boolean;
      /**
       * The database schema in which Graphile Worker's tables, functions, views, etc are
       * located. Database migrations will create or edit things in this schema
       * if necessary.
       *
       * @defaultValue `graphile_worker`
       */
      schema?: string;
      /**
       * The path to a directory in which Graphile Worker should look for task executors.
       *
       * @defaultValue `process.cwd() + "/tasks"`
       */
      taskDirectory?: string;
      /**
       * The path to a file in which Graphile Worker should look for crontab schedules.
       *
       * @defaultValue `process.cwd() + "/crontab"`
       */
      crontabFile?: string;
      /**
       * Number of jobs to run concurrently on a single worker.
       *
       * @defaultValue `1`
       */
      concurrentJobs?: number;
      /**
       * A list of file extensions (in priority order) that Graphile Worker should
       * attempt to import directly when loading task executors from the file system.
       *
       * @defaultValue `[".js", ".cjs", ".mjs"]`
       */
      fileExtensions?: string[];
      /**
       * How long in milliseconds after a gracefulShutdown is triggered should
       * Graphile Worker wait to trigger the AbortController, which should cancel
       * supported asynchronous actions?
       *
       * @defaultValue `5_000`
       */
      gracefulShutdownAbortTimeout?: number;
      /**
       * Set to `true` to use the time as recorded by Node.js rather than
       * PostgreSQL. It's strongly recommended that you ensure the Node.js and
       * PostgreSQL times are synchronized, making this setting moot.
       *
       * @defaultValue `false`
       */
      useNodeTime?: boolean;
      /**
       * **Experimental**
       *
       * How often should Graphile Worker scan for and release jobs that have been
       * locked too long? This is the minimum interval in milliseconds. Graphile
       * Worker will choose a time between this and `maxResetLockedInterval`.
       *
       * @defaultValue `480_000`
       */
      minResetLockedInterval?: number;
      /**
       * **Experimental**
       *
       * In milliseconds, the upper bound of how long Graphile Worker will wait
       * between scans for jobs that have been locked too long (see
       * `minResetLockedInterval`).
       *
       * @defaultValue `600_000`
       */
      maxResetLockedInterval?: number;
      /**
       * **Experimental**
       *
       * The window size in milliseconds in which Graphile Worker batches calls for
       * getting a queue name in a job. This batching is done for efficiency. Increase
       * this window for greater efficiency. Reduce this window to reduce the
       * latency for getting an individual queue name.
       *
       * @defaultValue `50`
       */
      getQueueNameBatchDelay?: number;
      /**
       * A Logger instance.
       */
      logger?: Logger;
      /**
       * A Node.js `EventEmitter` that exposes certain events within the runner.
       */
      events?: WorkerEvents;
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
      init(): void;

      /**
       * Called before installing the Graphile Worker DB schema (or upgrading it).
       */
      prebootstrap(event: GraphileWorker.MigrateEvent): PromiseOrDirect<void>;

      /**
       * Called after installing the Graphile Worker DB schema (or upgrading it).
       */
      postbootstrap(event: GraphileWorker.MigrateEvent): PromiseOrDirect<void>;

      /**
       * Called before migrating the DB.
       */
      premigrate(event: GraphileWorker.MigrateEvent): PromiseOrDirect<void>;

      /**
       * Called after migrating the DB.
       */
      postmigrate(event: GraphileWorker.MigrateEvent): PromiseOrDirect<void>;

      /**
       * Called if an error occurs during migration.
       */
      migrationError(
        event: GraphileWorker.MigrateEvent & { error: Error },
      ): PromiseOrDirect<void>;

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
