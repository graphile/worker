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
export { makeWorkerUtils, quickAddJob } from "./workerUtils";

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
      taskDirectory?: string;
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

      /**
       * Set `true` to use the time as recorded by Node.js rather than
       * PostgreSQL. It's strongly recommended that you ensure the Node.js and
       * PostgreSQL times are synchronized, making this setting moot.
       */
      useNodeTime?: boolean;

      /**
       * **Experimental**
       *
       * How often should we scan for jobs that have been locked too long and
       * release them? This is the minimum interval, we'll choose a time between
       * this and `maxResetLockedInterval`.
       */
      minResetLockedInterval?: number;
      /**
       * **Experimental**
       *
       * The upper bound of how long we'll wait between scans for jobs that have
       * been locked too long. See `minResetLockedInterval`.
       */
      maxResetLockedInterval?: number;

      /**
       * **Experimental**
       *
       * When getting a queue name in a job, we batch calls for efficiency. By
       * default we do this over a 50ms window; increase this for greater efficiency,
       * reduce this to reduce the latency for getting an individual queue name.
       */
      getQueueNameBatchDelay?: number;

      /**
       * A Logger instance.
       */
      logger?: Logger;

      events?: WorkerEvents;

      /**
       * To enable processing jobs in batches, set this to an integer larger
       * than 1. This will result in jobs being fetched by the pool rather than
       * the worker, the pool will fetch (and lock!) `localQueueSize` jobs up
       * front, and each time a worker requests a job it will be served from
       * this list until the list is exhausted, at which point a new set of
       * jobs will be fetched (and locked).
       *
       * This setting can help reduce the load on your database from looking
       * for jobs, but is only really effective when there are often many jobs
       * queued and ready to go, and can increase the latency of job execution
       * because a single worker may lock jobs into its queue leaving other
       * workers idle.
       *
       * @default `-1`
       */
      localQueueSize?: number;

      /**
       * How long should jobs sit in the local queue before they are returned
       * to the database? Defaults to 5 minutes.
       *
       * @default `300000`
       */
      localQueueTtl?: number;

      /**
       * The time in milliseconds to wait after a `completeJob` call to see if
       * there are any other completeJob calls that can be batched together. A
       * setting of `-1` disables this.
       *
       * Enabling this feature increases the time for which jobs are locked
       * past completion, thus increasing the risk of catastrophic failure
       * resulting in the jobs being executed again once they expire.
       *
       * @default `-1`
       */
      completeJobBatchDelay?: number;

      /**
       * The time in milliseconds to wait after a `failJob` call to see if
       * there are any other failJob calls that can be batched together. A
       * setting of `-1` disables this.
       *
       * Enabling this feature increases the time for which jobs are locked
       * past failure.
       *
       * @default `-1`
       */
      failJobBatchDelay?: number;
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
