import { PluginHook } from "graphile-config";

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
export { run, runMigrations, runOnce } from "./runner";
export { makeWorkerUtils, quickAddJob } from "./workerUtils";

export { getTasks };
export { getCronItems };

export interface WorkerPluginContext {
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
      loadTaskFromFiles(
        mutableEvent: {
          handler?: Task;
        },
        details: {
          taskIdentifier: string;
          fileDetailsList: readonly FileDetails[];
        },
      ): PromiseOrDirect<void>;
    }
  }
}
