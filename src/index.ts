import getCronItems from "./getCronItems";
import getTasks from "./getTasks";
export { parseCronItem, parseCronItems, parseCrontab } from "./crontab";
export * from "./interfaces";
export { digestPreset } from "./lib";
export { consoleLogFactory, LogFunctionFactory, Logger } from "./logger";
export { runTaskList, runTaskListOnce } from "./main";
export { run, runMigrations, runOnce } from "./runner";
export { makeWorkerUtils, quickAddJob } from "./workerUtils";

export { getTasks };
export { getCronItems };

declare global {
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
       * [EXPERIMENTAL] Watch task files for changes, automatically reloading
       * the task code without restarting worker.
       *
       * @defaultValue `false`
       */
      watch?: boolean;
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
       * How many errors in a row can we get fetching a job before we raise a higher
       * exception?
       */
      maxContiguousErrors?: number;
    }
    interface Preset {
      worker?: WorkerOptions;
    }
  }
}
