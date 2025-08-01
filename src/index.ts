import { Logger } from "@graphile/logger";
import { MiddlewareHandlers, PluginHook } from "graphile-config";
import type { PoolClient } from "pg";

import { getCronItems } from "./getCronItems";
import { getTasks } from "./getTasks";
import {
  FileDetails,
  PromiseOrDirect,
  RunOnceOptions,
  SharedOptions,
  Task,
  TaskList,
  WithPgClient,
  Worker,
  WorkerEvents,
  WorkerPluginBaseContext,
  WorkerPluginContext,
  WorkerPool,
  WorkerSharedOptions,
  WorkerUtilsOptions,
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
    interface InitEvent {
      ctx: WorkerPluginBaseContext;
    }
    interface BootstrapEvent {
      ctx: WorkerPluginContext;

      /**
       * The client used to perform the bootstrap. Replacing this is not officially
       * supported, but...
       */
      client: PoolClient;

      /**
       * The Postgres version number, e.g. 120000 for PostgreSQL 12.0
       */
      readonly postgresVersion: number;

      /**
       * Somewhere to store temporary data from plugins, only used during
       * bootstrap and migrate
       */
      readonly scratchpad: Record<string, unknown>;
    }

    interface MigrateEvent {
      ctx: WorkerPluginContext;

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

    interface PoolGracefulShutdownEvent {
      ctx: WorkerPluginContext;
      workerPool: WorkerPool;
      message: string;
    }

    interface PoolForcefulShutdownEvent {
      ctx: WorkerPluginContext;
      workerPool: WorkerPool;
      message: string;
    }

    interface PoolWorkerPrematureExitEvent {
      ctx: WorkerPluginContext;
      workerPool: WorkerPool;
      worker: Worker;
      /**
       * Use this to spin up a new Worker in place of the old one that failed.
       * Generally a Worker fails due to some underlying network or database
       * issue, and just spinning up a new one in its place may simply mask the
       * issue, so this is not recommended.
       *
       * Only the first call to this method (per event) will have any effect.
       */
      replaceWithNewWorker(): void;
    }
  }

  namespace GraphileConfig {
    interface WorkerOptions {
      /**
       * Database [connection string](https://worker.graphile.org/docs/connection-string).
       *
       * @defaultValue `process.env.DATABASE_URL`
       */
      connectionString?: string;

      /**
       * Maximum number of concurrent connections to Postgres; must be at least
       * `2`. This number can be lower than `concurrentJobs`, however a low
       * pool size may cause issues: if all your pool clients are busy then no
       * jobs can be started or released. If in doubt, we recommend setting it
       * to `10` or `concurrentJobs + 2`, whichever is larger. (Note: if your
       * task executors use this pool, then an even larger value may be needed
       * for optimum performance, depending on the shape of your logic.)
       *
       * @defaultValue `10`
       */
      maxPoolSize?: number;

      /**
       *
       * @defaultValue `2000` */
      pollInterval?: number;

      /**
       * Whether Graphile Worker should use prepared statements. Set `false` if
       * you use software (e.g. some Postgres pools) that don't support them.
       *
       * @defaultValue `true`
       */
      preparedStatements?: boolean;

      /**
       * The database schema in which Graphile Worker's tables, functions,
       * views, etc are located. Graphile Worker will create or edit things in
       * this schema as necessary.
       *
       * @defaultValue `graphile_worker`
       */
      schema?: string;

      /**
       * The path to a directory in which Graphile Worker should look for task
       * executors.
       *
       * @defaultValue `process.cwd() + "/tasks"`
       */
      taskDirectory?: string;

      /**
       * The path to a file in which Graphile Worker should look for crontab
       * schedules. See: [recurring tasks
       * (crontab)](https://worker.graphile.org/docs/cron)).
       *
       * @defaultValue `process.cwd() + "/crontab"`
       */
      crontabFile?: string;

      /**
       * Number of jobs to run concurrently on a single Graphile Worker
       * instance.
       *
       * @defaultValue `1`
       */
      concurrentJobs?: number;

      /**
       * A list of file extensions (in priority order) that Graphile Worker
       * should attempt to import as Node modules when loading task executors from
       * the file system.
       *
       * @defaultValue `[".js", ".cjs", ".mjs"]`
       */
      fileExtensions?: string[];

      /**
       * How long in milliseconds after a gracefulShutdown is triggered should
       * Graphile Worker wait to trigger the AbortController, which should
       * cancel supported asynchronous actions?
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
       * How often should Graphile Worker scan for and release jobs that have
       * been locked too long? This is the minimum interval in milliseconds.
       * Graphile Worker will choose a time between this and
       * `maxResetLockedInterval`.
       *
       * @defaultValue `480_000`
       */
      minResetLockedInterval?: number;

      /**
       * **Experimental**
       *
       * The upper bound of how long (in milliseconds) Graphile Worker will
       * wait between scans for jobs that have been locked too long (see
       * `minResetLockedInterval`).
       *
       * @defaultValue `600_000`
       */
      maxResetLockedInterval?: number;

      /**
       * **Experimental**
       *
       * The size, in milliseconds, of the time window over which Graphile
       * Worker will batch requests to retrieve the queue name of a job.
       * Increase the size of this window for greater efficiency, or reduce it
       * to improve latency.
       *
       * @defaultValue `50`
       */
      getQueueNameBatchDelay?: number;

      /**
       * A Logger instance (see [Logger](https://worker.graphile.org/docs/library/logger)).
       */
      logger?: Logger;

      /**
       * Provide your own Node.js `EventEmitter` in order to be able to receive
       * events (see
       * [`WorkerEvents`](https://worker.graphile.org/docs/worker-events)) that
       * occur during Graphile Worker's startup. (Without this, Worker will
       * provision its own `EventEmitter`, but you can't retrieve it until the
       * promise returned by the API you have called has resolved.)
       */
      events?: WorkerEvents;

      /**
       * If you're running in high concurrency, you will likely want to reduce
       * the load on the database by using a local queue to distribute jobs to
       * workers rather than having each ask the database directly.
       */
      localQueue?: {
        /**
         * To enable processing jobs in batches, set this to an integer larger
         * than 1. This will result in jobs being fetched by the pool rather than
         * the worker, the pool will fetch (and lock!) `localQueue.size` jobs up
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
        size: number;

        /**
         * How long (in milliseconds) should jobs sit in the local queue before
         * they are returned to the database? Defaults to 5 minutes.
         *
         * @default `300000`
         */
        ttl?: number;

        /**
         * When running at very high scale (multiple worker instances, each
         * with some level of concurrency), Worker's polling can cause
         * significant load on the database when there are too few jobs in the
         * database to keep all worker pools busy - each time a new job comes
         * in, each pool may request it, multiplying up the load. To reduce
         * this impact, when a pool receives no (or few) results to its query
         * for new jobs, we can instigate a "refetch delay" to cause the pool
         * to wait before issuing its next poll for jobs, even when new job
         * notifications come in.
         */
        refetchDelay?: {
          /**
           * How long in milliseconds to wait, on average, before asking for
           * more jobs when a previous fetch results in insufficient jobs to
           * fill the local queue. (Causes the local queue to (mostly) ignore
           * "new job" notifications.)
           *
           * When new jobs are coming in but the workers are mostly idle, you
           * can expect on average `(1000/durationMs) * INSTANCE_COUNT` "get jobs"
           * queries per second to be issued to your database. Increasing this
           * decreases database load at the cost of increased latency when there
           * are insufficient jobs in the database to keep the local queue full.
           */
          durationMs: number;

          /**
           * How many jobs should a fetch return to trigger the refetchDelay?
           * Must be less than the local queue size
           *
           * @default {0}
           */
          threshold?: number;

          /**
           * How many new jobs can a pool that's in refetch delay be notified
           * of before it must abort the refetch delay and fetch anyway.
           *
           * Note that because you may have many different workers in refetch
           * delay we take a random number up to this threshold, this means
           * that different workers will abort refetch delay at different times
           * which a) helps avoid the thundering herd problem, and b) helps to
           * reduce the latency of executing a new job when all workers are in
           * refetch delay.
           *
           * We don't know the best value for this, it likely will change based
           * on a large number of factors. If you're not sure what to set it
           * to, we recommend you start by taking `localQueue.size` and
           * multiplying it by the number of Graphile Worker instances you're
           * running (ignoring their `concurrency` settings). Then iterate
           * based on the behaviors you observe. And report back to us - we'd
           * love to hear about what works and what doesn't!
           *
           * To force the full refetch delay to always apply, set this to
           * `Infinity` since `Math.random() * Infinity = Infinity` (except in
           * the case that Math.random() is zero, but that's only got a 1 in
           * 2^53 chance of happening so you're probably fine, right? Don't
           * worry, we handle this.)
           *
           * @default {5 * localQueue.size}
           */
          maxAbortThreshold?: number;
        };
      };

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
      /** Options for Graphile Worker */
      worker?: WorkerOptions;
    }

    interface Plugin {
      /** Plugin hooks and middleware for Graphile Worker */
      worker?: {
        middleware?: MiddlewareHandlers<WorkerMiddleware>;

        // TODO: deprecate this, replace with middleware
        hooks?: {
          [key in keyof WorkerHooks]?: PluginHook<
            WorkerHooks[key] extends (...args: infer UArgs) => infer UResult
              ? (ctx: WorkerPluginContext, ...args: UArgs) => UResult
              : never
          >;
        };
      };
    }

    interface WorkerMiddleware {
      /**
       * Called when Graphile Worker starts up.
       */
      init<
        T extends
          | SharedOptions
          | WorkerSharedOptions
          | WorkerOptions
          | RunOnceOptions
          | WorkerUtilsOptions,
      >(
        event: GraphileWorker.InitEvent,
      ): CompiledSharedOptions<T>;

      /**
       * Called when installing the Graphile Worker DB schema (or upgrading it).
       */
      bootstrap(event: GraphileWorker.BootstrapEvent): PromiseOrDirect<void>;

      /**
       * Called when migrating the Graphile Worker DB.
       */
      migrate(event: GraphileWorker.MigrateEvent): PromiseOrDirect<void>;

      /**
       * Called when performing a graceful shutdown on a WorkerPool.
       */
      poolGracefulShutdown(
        event: GraphileWorker.PoolGracefulShutdownEvent,
      ): ReturnType<WorkerPool["gracefulShutdown"]>;

      /**
       * Called when performing a forceful shutdown on a WorkerPool.
       */
      poolForcefulShutdown(
        event: GraphileWorker.PoolForcefulShutdownEvent,
      ): ReturnType<WorkerPool["forcefulShutdown"]>;

      /**
       * Called when a Worker inside a WorkerPool exits unexpectedly;
       * allows user to choose how to handle this; for example:
       *
       * - graceful shutdown (default behavior)
       * - forceful shutdown (probably best after a delay?)
       * - boot up a replacement worker via `createNewWorker`
       */
      poolWorkerPrematureExit(
        event: GraphileWorker.PoolWorkerPrematureExitEvent,
      ): void;
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
