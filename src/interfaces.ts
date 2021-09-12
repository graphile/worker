import { EventEmitter } from "events";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { Release } from "./lib";
import { Logger } from "./logger";
import { Signal } from "./signals";

/*
 * Terminology:
 *
 * - job: an entry in the `jobs` table, representing work to be done
 * - queue: an entry in the `job_queues` table, representing a list of jobs to be executed sequentially
 * - task_identifier: the name of the task to be executed to complete the job
 * - task: a function representing code to be executed for a particular job (identified by the task_identifier); i.e. a file in the `tasks/` folder
 * - task list: an object collection of named tasks
 * - watched task list: an abstraction for a task list that can be updated when the tasks on the disk change
 * - worker: the thing that checks out a job from the database, executes the relevant task, and then returns the job to the database with either success or failure
 * - worker pool: a collection of workers to enable processing multiple jobs in parallel
 * - runner: the thing responsible for building a task list and running a worker pool for said list
 */

export type WithPgClient = <T = void>(
  callback: (pgClient: PoolClient) => Promise<T>,
) => Promise<T>;

/**
 * The `addJob` interface is implemented in many places in the library, all
 * conforming to this.
 */
export type AddJobFunction = (
  /**
   * The name of the task that will be executed for this job.
   */
  identifier: string,

  /**
   * The payload (typically a JSON object) that will be passed to the task executor.
   */
  payload?: unknown,

  /**
   * Additional details about how the job should be handled.
   */
  spec?: TaskSpec,
) => Promise<Job>;

export interface Helpers {
  /**
   * A Logger instance.
   */
  logger: Logger;

  /**
   * Grabs a PostgreSQL client from the pool, awaits your callback, then
   * releases the client back to the pool.
   */
  withPgClient: WithPgClient;

  /**
   * Adds a job into our queue.
   */
  addJob: AddJobFunction;
}

export interface JobHelpers extends Helpers {
  /**
   * A Logger instance, scoped to this job.
   */
  logger: Logger;

  /**
   * The currently executing job.
   */
  job: Job;

  /**
   * A shorthand for running an SQL query within the job.
   */
  query<R extends QueryResultRow>(
    queryText: string,
    values?: any[],
  ): Promise<QueryResult<R>>;
}

/**
 * Utilities for working with Graphile Worker. Primarily useful for migrating
 * the jobs database and queueing jobs.
 */
export interface WorkerUtils extends Helpers {
  /**
   * A Logger instance, scoped to label: 'WorkerUtils'
   */
  logger: Logger;

  /**
   * Use this to release the WorkerUtils when you no longer need it.
   * Particularly useful in tests, or in short-running scripts.
   */
  release: Release;

  /**
   * Migrate the database schema to the latest version.
   */
  migrate: () => Promise<void>;

  /**
   * Marks the specified jobs (by their ids) as if they were completed,
   * assuming they are not locked. Note that completing a job deletes it. You
   * may mark failed and permanently failed jobs as completed if you wish. The
   * deleted jobs will be returned (note that this may be fewer jobs than you
   * requested).
   */
  completeJobs: (ids: string[]) => Promise<Job[]>;

  /**
   * Marks the specified jobs (by their ids) as failed permanently, assuming
   * they are not locked. This means setting their `attempts` equal to their
   * `max_attempts`. The updated jobs will be returned (note that this may be
   * fewer jobs than you requested).
   */
  permanentlyFailJobs: (ids: string[], reason?: string) => Promise<Job[]>;

  /**
   * Updates the specified scheduling properties of the jobs (assuming they are
   * not locked). All of the specified options are optional, omitted or null
   * values will left unmodified.
   *
   * This method can be used to postpone or advance job execution, or to
   * schedule a previously failed or permanently failed job for execution. The
   * updated jobs will be returned (note that this may be fewer jobs than you
   * requested).
   */
  rescheduleJobs: (
    ids: string[],
    options: {
      runAt?: string | Date;
      priority?: number;
      attempts?: number;
      maxAttempts?: number;
    },
  ) => Promise<Job[]>;
}

export type Task = (
  payload: unknown,
  helpers: JobHelpers,
) => void | Promise<void>;

export function isValidTask(fn: unknown): fn is Task {
  if (typeof fn === "function") {
    return true;
  }
  return false;
}

export interface TaskList {
  [name: string]: Task;
}

export interface WatchedTaskList {
  tasks: TaskList;
  release: () => void;
}

export interface WatchedCronItems {
  items: Array<ParsedCronItem>;
  release: () => void;
}

/**
 * a.k.a. `opts`, this allows you to change the behaviour when scheduling a cron task.
 */
export interface CronItemOptions {
  /** How far back (in milliseconds) should we backfill jobs when worker starts? (Only backfills since when the identifier was first used.) */
  backfillPeriod: number;

  /** Optionally override the default job max_attempts */
  maxAttempts?: number;

  /** Optionally set the job queue_name to enforce that the jobs run serially */
  queueName?: string;

  /** Optionally set the job priority */
  priority?: number;
}

/**
 * A recurring task schedule; this may represent a line in the `crontab` file,
 * or may be the result of calling `parseCronItems` on a list of `CronItem`s
 * the user has specified.
 *
 * You should use this as an opaque type; you should **not** read values from
 * inside it, and you should not construct it manually, use `parseCrontab` or
 * `parseCronItems` instead. The definition of this type may change
 * dramatically between minor releases of Graphile Worker, these changes are
 * not seen as breaking changes.
 *
 * @internal
 *
 * **WARNING**: it is assumed that values of this type adhere to the constraints in
 * the comments below (many of these cannot be asserted by TypeScript). If you
 * construct this type manually and do not adhere to these constraints then you
 * may get unexpected behaviours. Graphile Worker enforces these rules when
 * constructing `ParsedCronItem`s internally, you should use the Graphile
 * Worker helpers to construct this type.
 */
export interface ParsedCronItem {
  /** Minutes (0-59) on which to run the item; must contain unique numbers from the allowed range, ordered ascending. */
  minutes: number[];
  /** Hours (0-23) on which to run the item; must contain unique numbers from the allowed range, ordered ascending. */
  hours: number[];
  /** Dates (1-31) on which to run the item; must contain unique numbers from the allowed range, ordered ascending. */
  dates: number[];
  /** Months (1-12) on which to run the item; must contain unique numbers from the allowed range, ordered ascending. */
  months: number[];
  /** Days of the week (0-6) on which to run the item; must contain unique numbers from the allowed range, ordered ascending. */
  dows: number[];

  /** The identifier of the task to execute */
  task: string;

  /** Options influencing backfilling and properties of the scheduled job */
  options: CronItemOptions;

  /** A payload object to merge into the default cron payload object for the scheduled job */
  payload: { [key: string]: any };

  /** An identifier so that we can prevent double-scheduling of a task and determine whether or not to backfill. */
  identifier: string;
}

/**
 * A description of a cron item detailing a task to run, when to run it, and
 * any additional options necessary. This is the human-writable form, it must
 * be parsed via `parseCronItems` before being fed to a worker. (ParsedCronItem
 * has strict rules and should only be constructed via Graphile Worker's
 * helpers to ensure compliance.)
 */
export interface CronItem {
  /** The identifier of the task to execute */
  task: string;

  /** Cron pattern (e.g. `* * * * *`) to detail when the task should be executed */
  pattern: string;

  /** Options influencing backfilling and properties of the scheduled job */
  options?: CronItemOptions;

  /** A payload object to merge into the default cron payload object for the scheduled job */
  payload?: { [key: string]: any };

  /** An identifier so that we can prevent double-scheduling of a task and determine whether or not to backfill. */
  identifier?: string;
}

/** Represents records in the `jobs` table */
export interface Job {
  id: string;
  queue_name: string | null;
  task_identifier: string;
  payload: unknown;
  priority: number;
  run_at: Date;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  key: string | null;
  revision: number;
  locked_at: Date | null;
  locked_by: string | null;
  flags: { [flag: string]: true } | null;
}

/** Represents records in the `known_crontabs` table */
export interface KnownCrontab {
  identifier: string;
  known_since: Date;
  last_execution: Date | null;
}

export interface Worker {
  nudge: () => boolean;
  workerId: string;
  release: () => void;
  promise: Promise<void>;
  getActiveJob: () => Job | null;
}

export interface WorkerPool {
  release: () => Promise<void>;
  gracefulShutdown: (message: string) => Promise<void>;
  promise: Promise<void>;
}

export interface Runner {
  stop: () => Promise<void>;
  addJob: AddJobFunction;
  promise: Promise<void>;
  events: WorkerEvents;
}

export interface Cron {
  release(): Promise<void>;
  promise: Promise<void>;
}

export interface TaskSpec {
  /**
   * The queue to run this task under (only specify if you want jobs in this
   * queue to run serially). (Default: null)
   */
  queueName?: string;

  /**
   * A Date to schedule this task to run in the future. (Default: now)
   */
  runAt?: Date;

  /**
   * Jobs are executed in numerically ascending order of priority (jobs with a
   * numerically smaller priority are run first). (Default: 0)
   */
  priority?: number;

  /**
   * How many retries should this task get? (Default: 25)
   */
  maxAttempts?: number;

  /**
   * Unique identifier for the job, can be used to update or remove it later if
   * needed. (Default: null)
   */
  jobKey?: string;

  /**
   * Modifies the behavior of `jobKey`; when 'replace' all attributes will be
   * updated, when 'preserve_run_at' all attributes except 'run_at' will be
   * updated, when 'unsafe_dedupe' a new job will only be added if no existing
   * job (including locked jobs and permanently failed jobs) with matching job
   * key exists. (Default: 'replace')
   */
  jobKeyMode?: "replace" | "preserve_run_at" | "unsafe_dedupe";

  /**
   * Flags for the job, can be used to dynamically filter which jobs can and
   * cannot run at runtime. (Default: null)
   */
  flags?: string[];
}

export type ForbiddenFlagsFn = () => null | string[] | Promise<null | string[]>;

/**
 * These options are common Graphile Worker pools, workers, and utils.
 */
export interface SharedOptions {
  /**
   * How should messages be logged out? Defaults to using the console logger.
   */
  logger?: Logger;

  /**
   * Which PostgreSQL schema should Graphile Worker use? Defaults to 'graphile_worker'.
   */
  schema?: string;

  /**
   * A PostgreSQL connection string to the database containing the job queue
   */
  connectionString?: string;

  /**
   * The maximum size of the PostgreSQL pool. Defaults to the node-postgres
   * default (10). Only useful when `connectionString` is given.
   */
  maxPoolSize?: number;

  /**
   * A pg.Pool instance to use instead of the `connectionString`
   */
  pgPool?: Pool;

  /**
   * Set true if you want to prevent the use of prepared statements; for
   * example if you wish to use Graphile Worker with pgBouncer or similar.
   */
  noPreparedStatements?: boolean;

  /**
   * An array of strings or function returning an array of strings or promise resolving to
   * an array of strings that represent flags
   *
   * Graphile worker will skip the execution of any jobs that contain these flags
   */
  forbiddenFlags?: null | string[] | ForbiddenFlagsFn;

  /**
   * An EventEmitter instance to which we'll emit events.
   */
  events?: WorkerEvents;
}

/**
 * Shared between pools and individual workers.
 */
export interface WorkerSharedOptions extends SharedOptions {
  /**
   * How long to wait between polling for jobs in milliseconds (for jobs scheduled in the future/retries)
   */
  pollInterval?: number;
}

/**
 * Options for an individual worker
 */
export interface WorkerOptions extends WorkerSharedOptions {
  /**
   * An identifier for this specific worker; if unset then a random ID will be assigned. Do not assign multiple workers the same worker ID!
   */
  workerId?: string;
}

/**
 * Options for a worker pool.
 */
export interface WorkerPoolOptions extends WorkerSharedOptions {
  /**
   * Number of jobs to run concurrently
   */
  concurrency?: number;

  /**
   * If set true, we won't install signal handlers and it'll be up to you to
   * handle graceful shutdown of the worker if the process receives a signal.
   */
  noHandleSignals?: boolean;
}

/**
 * Options for the `run`, `runOnce` and `runMigrations` methods.
 */
export interface RunnerOptions extends WorkerPoolOptions {
  /**
   * Task names and handler, e.g. from `getTasks` (use this if you need watch mode)
   */
  taskList?: TaskList;

  /**
   * Each file in this directory will be used as a task handler
   */
  taskDirectory?: string;

  /**
   * A crontab string to use instead of reading a crontab file
   */
  crontab?: string;

  /**
   * Path to the crontab file. Defaults to `crontab`
   */
  crontabFile?: string;

  /**
   * Programmatically generated cron items. **BE VERY CAREFUL** if you use this
   * manually, there are requirements on this type that TypeScript cannot
   * express, and if you don't adhere to them then you'll get unexpected
   * behaviours.
   */
  parsedCronItems?: Array<ParsedCronItem>;
}

/** Spec for a job created from cron */
export interface CronJob {
  task: string;
  payload: {
    [key: string]: unknown;
  };
  queueName?: string;
  maxAttempts?: number;
  priority?: number;
}

export interface JobAndCronIdentifier {
  job: CronJob;
  identifier: string;
}

export interface WorkerUtilsOptions extends SharedOptions {}

type BaseEventMap = Record<string, any>;
type EventMapKey<TEventMap extends BaseEventMap> = string & keyof TEventMap;
type EventCallback<TPayload> = (params: TPayload) => void;

interface TypedEventEmitter<TEventMap extends BaseEventMap>
  extends EventEmitter {
  addListener<TEventName extends EventMapKey<TEventMap>>(
    eventName: TEventName,
    callback: EventCallback<TEventMap[TEventName]>,
  ): this;
  on<TEventName extends EventMapKey<TEventMap>>(
    eventName: TEventName,
    callback: EventCallback<TEventMap[TEventName]>,
  ): this;
  once<TEventName extends EventMapKey<TEventMap>>(
    eventName: TEventName,
    callback: EventCallback<TEventMap[TEventName]>,
  ): this;

  removeListener<TEventName extends EventMapKey<TEventMap>>(
    eventName: TEventName,
    callback: EventCallback<TEventMap[TEventName]>,
  ): this;
  off<TEventName extends EventMapKey<TEventMap>>(
    eventName: TEventName,
    callback: EventCallback<TEventMap[TEventName]>,
  ): this;

  emit<TEventName extends EventMapKey<TEventMap>>(
    eventName: TEventName,
    params: TEventMap[TEventName],
  ): boolean;
}

/**
 * These are the events that a worker instance supports.
 */
export type WorkerEventMap = {
  /**
   * When a worker pool is created
   */
  "pool:create": { workerPool: WorkerPool };

  /**
   * When a worker pool attempts to connect to PG ready to issue a LISTEN
   * statement
   */
  "pool:listen:connecting": { workerPool: WorkerPool };

  /**
   * When a worker pool starts listening for jobs via PG LISTEN
   */
  "pool:listen:success": { workerPool: WorkerPool; client: PoolClient };

  /**
   * When a worker pool faces an error on their PG LISTEN client
   */
  "pool:listen:error": {
    workerPool: WorkerPool;
    error: any;
    client: PoolClient;
  };

  /**
   * When a worker pool is released
   */
  "pool:release": { pool: WorkerPool };

  /**
   * When a worker pool starts a graceful shutdown
   */
  "pool:gracefulShutdown": { pool: WorkerPool; message: string };

  /**
   * When a worker pool graceful shutdown throws an error
   */
  "pool:gracefulShutdown:error": { pool: WorkerPool; error: any };

  /**
   * When a worker is created
   */
  "worker:create": { worker: Worker; tasks: TaskList };

  /**
   * When a worker release is requested
   */
  "worker:release": { worker: Worker };

  /**
   * When a worker stops (normally after a release)
   */
  "worker:stop": { worker: Worker; error?: any };

  /**
   * When a worker is about to ask the database for a job to execute
   */
  "worker:getJob:start": { worker: Worker };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:error": { worker: Worker; error: any };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:empty": { worker: Worker };

  /**
   * When a worker is created
   */
  "worker:fatalError": { worker: Worker; error: any; jobError: any | null };

  /**
   * When a job is retrieved by get_job
   */
  "job:start": { worker: Worker; job: Job };

  /**
   * When a job completes successfully
   */
  "job:success": { worker: Worker; job: Job };

  /**
   * When a job throws an error
   */
  "job:error": { worker: Worker; job: Job; error: any };

  /**
   * When a job fails permanently (emitted after job:error when appropriate)
   */
  "job:failed": { worker: Worker; job: Job; error: any };

  /**
   * When a job has finished executing and the result (success or failure) has
   * been written back to the database
   */
  "job:complete": { worker: Worker; job: Job; error: any };

  /** **Experimental** When the cron starts working (before backfilling) */
  "cron:starting": { cron: Cron; start: Date };

  /** **Experimental** When the cron starts working (after backfilling completes) */
  "cron:started": { cron: Cron; start: Date };

  /** **Experimental** When a number of jobs need backfilling for a particular timestamp. */
  "cron:backfill": {
    cron: Cron;
    itemsToBackfill: JobAndCronIdentifier[];
    timestamp: string;
  };

  /**
   * **Experimental** When it seems that time went backwards (e.g. the system
   * clock was adjusted) and we try again a little later.
   */
  "cron:prematureTimer": {
    cron: Cron;
    currentTimestamp: number;
    expectedTimestamp: number;
  };

  /**
   * **Experimental** When it seems that time jumped forwards (e.g. the system
   * was overloaded and couldn't fire the timer on time, or perhaps the system
   * went to sleep) and we need to catch up.
   */
  "cron:overdueTimer": {
    cron: Cron;
    currentTimestamp: number;
    expectedTimestamp: number;
  };

  /**
   * **Experimental** When 1 or more cron items match the current timestamp and
   * will be scheduled into the database. (Like cron:scheduled but before the
   * database write.)
   */
  "cron:schedule": {
    cron: Cron;
    timestamp: number;
    jobsAndIdentifiers: JobAndCronIdentifier[];
  };

  /**
   * **Experimental** When 1 or more cron items match the current timestamp and
   * were scheduled into the database. (Like cron:schedule but after the
   * database write.)
   */
  "cron:scheduled": {
    cron: Cron;
    timestamp: number;
    jobsAndIdentifiers: JobAndCronIdentifier[];
  };

  /**
   * When the runner is terminated by a signal
   */
  gracefulShutdown: { signal: Signal };

  /**
   * When the runner is stopped
   */
  stop: {};
};

export type WorkerEvents = TypedEventEmitter<WorkerEventMap>;
