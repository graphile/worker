/* eslint-disable @typescript-eslint/ban-types */
import type { EventEmitter } from "events";
import type { Stats } from "fs";
import { AsyncHooks } from "graphile-config";
import type {
  Notification,
  Pool,
  PoolClient,
  QueryResult,
  QueryResultRow,
} from "pg";

import type {
  CompiledSharedOptions,
  Release,
  ResolvedWorkerPreset,
} from "./lib";
import type { Logger } from "./logger";
import type { Signal } from "./signals";

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

export interface WithPgClient {
  <T = void>(callback: (pgClient: PoolClient) => Promise<T>): Promise<T>;
}

export interface EnhancedWithPgClient extends WithPgClient {
  /** **Experimental**; see https://github.com/graphile/worker/issues/387 */
  withRetries: <T = void>(
    callback: (pgClient: PoolClient) => Promise<T>,
  ) => Promise<T>;
}

/**
 * The `addJob` interface is implemented in many places in the library, all
 * conforming to this.
 */
export type AddJobFunction = <
  TIdentifier extends keyof GraphileWorker.Tasks | (string & {}) = string,
>(
  /**
   * The name of the task that will be executed for this job.
   */
  identifier: TIdentifier,

  /**
   * The payload (typically a JSON object) that will be passed to the task executor.
   */
  payload: TIdentifier extends keyof GraphileWorker.Tasks
    ? GraphileWorker.Tasks[TIdentifier]
    : unknown,

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
   * Get the queue name of the give queue ID (or the currently executing job if
   * no queue id is specified).
   */
  getQueueName(queueId?: number | null): PromiseOrDirect<string | null>;

  /**
   * A shorthand for running an SQL query within the job.
   */
  query<R extends QueryResultRow>(
    queryText: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;

  /**
   * An AbortSignal that will be triggered when the job should exit.
   *
   * @experimental
   */
  abortSignal?: AbortSignal;
}

export type CleanupTask =
  | "GC_TASK_IDENTIFIERS"
  | "GC_JOB_QUEUES"
  | "DELETE_PERMAFAILED_JOBS";

export interface CleanupOptions {
  tasks?: readonly CleanupTask[];
  taskIdentifiersToKeep?: readonly string[];
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
  completeJobs: (ids: string[]) => Promise<DbJob[]>;

  /**
   * Marks the specified jobs (by their ids) as failed permanently, assuming
   * they are not locked. This means setting their `attempts` equal to their
   * `max_attempts`. The updated jobs will be returned (note that this may be
   * fewer jobs than you requested).
   */
  permanentlyFailJobs: (ids: string[], reason?: string) => Promise<DbJob[]>;

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
  ) => Promise<DbJob[]>;

  /**
   * Forcefully unlocks jobs for the given workers, leaving others unaffected.
   * Only use this if the workers in question are no longer running (crashed,
   * were terminated, are permanently unreachable, etc).
   */
  forceUnlockWorkers: (workerIds: string[]) => Promise<void>;

  /**
   * **Experimental**
   *
   * Database cleanup function. Supported tasks:
   *
   * - GC_TASK_IDENTIFIERS: delete task identifiers that are no longer referenced by any jobs
   * - GC_JOB_QUEUES: delete job queues that are no longer referenced by any jobs
   * - DELETE_PERMAFAILED_JOBS: delete permanently failed jobs if they are not locked
   *
   * Default: ["GC_JOB_QUEUES"]
   */
  cleanup(options: CleanupOptions): Promise<void>;
}

export type PromiseOrDirect<T> = Promise<T> | T;

export type Task<
  TName extends keyof GraphileWorker.Tasks | (string & {}) = string & {},
> = (
  payload: TName extends keyof GraphileWorker.Tasks
    ? GraphileWorker.Tasks[TName]
    : unknown,
  helpers: JobHelpers,
) => PromiseOrDirect<void | PromiseOrDirect<unknown>[]>;

export function isValidTask<T extends string = keyof GraphileWorker.Tasks>(
  fn: unknown,
): fn is Task<T> {
  if (typeof fn === "function") {
    return true;
  }
  return false;
}

export type TaskList = {
  [Key in
    | keyof GraphileWorker.Tasks
    | (string & {})]?: Key extends keyof GraphileWorker.Tasks
    ? Task<Key>
    : // The `any` here is required otherwise declaring something as a `TaskList` can cause issues.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Task<any>;
};

export interface WatchedTaskList {
  tasks: TaskList;
  release: () => void;
  /** @internal */
  compiledSharedOptions: CompiledSharedOptions;
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

  /** Optionally prevent duplicate copies of this job from running */
  jobKey?: string;

  /**
   * Modifies the behavior of `jobKey`; when 'replace' all attributes will be
   * updated, when 'preserve_run_at' all attributes except 'run_at' will be
   * updated. (Default: 'replace')
   */
  jobKeyMode?: "replace" | "preserve_run_at";
}

/**
 * Crontab ranges from the minute, hour, day of month, month and day of week
 * parts of the crontab line
 *
 * @internal
 *
 * You should use this as an opaque type; you should **not** read values from
 * inside it, and you should not construct it manually. The definition of this
 * type may change dramatically between minor releases of Graphile Worker,
 * these changes are not seen as breaking changes.
 *
 * **WARNING**: it is assumed that values of this type adhere to the constraints in
 * the comments below (many of these cannot be asserted by TypeScript). If you
 * construct this type manually and do not adhere to these constraints then you
 * may get unexpected behaviours. Graphile Worker enforces these rules when
 * constructing `ParsedCronMatch`s internally, you should use the Graphile
 * Worker helpers to construct this type.
 */
export interface ParsedCronMatch {
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
}

/**
 * A function which determines if a particular item should be executed for a
 * given TimestampDigest.
 */
export type CronMatcher = (digest: TimestampDigest) => boolean;

/**
 * Symbol to determine that the item was indeed fed through a parser function.
 *
 * @internal
 */
export const $$isParsed = Symbol("isParsed");

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
 */
export interface ParsedCronItem {
  /** @internal Used to guarantee that the item was parsed correctly */
  [$$isParsed]: true;

  /** Optimised function to determine if this item matches the given TimestampDigest */
  match: CronMatcher;

  /** The identifier of the task to execute */
  task: string;

  /** Options influencing backfilling and properties of the scheduled job */
  options: CronItemOptions;

  /** A payload object to merge into the default cron payload object for the scheduled job */
  payload: { [key: string]: unknown } | null;

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

  /** @deprecated Please rename this property to 'match' */
  pattern?: never;

  /** Cron pattern (e.g. `* * * * *`) or a function to detail when the task should be executed */
  match: string | CronMatcher;

  /** Options influencing backfilling and properties of the scheduled job */
  options?: CronItemOptions;

  /** A payload object to merge into the default cron payload object for the scheduled job */
  payload?: { [key: string]: unknown };

  /** An identifier so that we can prevent double-scheduling of a task and determine whether or not to backfill. */
  identifier?: string;
}

/** Represents records in the `jobs` table */
export interface DbJob {
  id: string;
  /** FK to job_queues */
  job_queue_id: number | null;
  /** FK to tasks */
  task_id: number;
  /** The JSON payload of the job */
  payload: unknown;
  /** Lower number means it should run sooner */
  priority: number;
  /** When it was due to run */
  run_at: Date;
  /** How many times it has been attempted */
  attempts: number;
  /** The limit for the number of times it should be attempted */
  max_attempts: number;
  /** If attempts > 0, why did it fail last? */
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
  /** "job_key" - unique identifier for easy update from user code */
  key: string | null;
  /** A count of the revision numbers */
  revision: number;
  locked_at: Date | null;
  locked_by: string | null;
  flags: { [flag: string]: true } | null;
  is_available: boolean;
}

export interface Job extends DbJob {
  /** Shortcut to tasks.identifier */
  task_identifier: string;
}

/** Represents records in the `known_crontabs` table */
export interface KnownCrontab {
  identifier: string;
  known_since: Date;
  last_execution: Date | null;
}

export interface Worker {
  workerPool: WorkerPool;
  nudge: () => boolean;
  workerId: string;
  release: (force?: boolean) => void | Promise<void>;
  promise: Promise<void>;
  getActiveJob: () => Job | null;
  /** @internal */
  _start: (() => void) | null;
}

export interface WorkerPool {
  id: string;
  /** Encourage `n` workers to look for jobs _right now_, cancelling the delay timers. */
  nudge(n: number): void;
  /** @deprecated Use gracefulShutdown instead */
  release: () => Promise<void>;
  gracefulShutdown: (message?: string) => Promise<void>;
  forcefulShutdown: (message: string) => Promise<void>;
  promise: Promise<void>;
  /** @experimental */
  abortSignal: AbortSignal;
  /** @internal */
  _shuttingDown: boolean;
  /** @internal */
  _forcefulShuttingDown: boolean;
  /** @internal */
  _active: boolean;
  /** @internal */
  _workers: Worker[];
  /** @internal */
  _withPgClient: WithPgClient;
  /** @internal */
  _start: (() => void) | null;
  /**
   * Only works if concurrency === 1!
   *
   * @internal
   */
  worker: Worker | null;

  then<TResult1 = void, TResult2 = never>(
    onfulfilled?:
      | ((value: void) => TResult1 | PromiseLike<TResult1>)
      | undefined
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | undefined
      | null,
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?:
      | ((reason: unknown) => TResult | PromiseLike<TResult>)
      | undefined
      | null,
  ): Promise<void | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<void>;
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
  /** @internal */
  _active: boolean;
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

/** Equivalent of graphile_worker.job_spec DB type */
export interface DbJobSpec<
  TIdentifier extends keyof GraphileWorker.Tasks | (string & {}) = string,
> {
  identifier: TIdentifier;
  payload: TIdentifier extends keyof GraphileWorker.Tasks
    ? GraphileWorker.Tasks[TIdentifier]
    : unknown;
  queue_name?: string | null;
  run_at?: string | null;
  max_attempts?: number | null;
  job_key?: string | null;
  priority?: number | null;
  flags?: string[] | null;
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

  /**
   * By default we use PostgreSQL's time source; in general this should be pretty close
   * (if not identical) to the time source your Node server is using, but in the case
   * that it isn't or you want to change it (e.g. in tests with fake date/time) you can
   * tell Worker to use Node's time source rather than Postgres' time source. (Default:
   * false.)
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

  preset?: GraphileConfig.Preset;

  /**
   * How long in milliseconds after a gracefulShutdown is triggered should
   * we wait to trigger the AbortController, which should cancel supported
   * asynchronous actions?
   *
   * @defaultValue `5000`
   */
  gracefulShutdownAbortTimeout?: number;
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

  abortSignal?: AbortSignal;

  workerPool: WorkerPool;

  /**
   * If set true, we won't install signal handlers and it'll be up to you to
   * handle graceful shutdown of the worker if the process receives a signal.
   */
  noHandleSignals?: boolean;

  /** If false, worker won't start looking for jobs until you call `worker._start()` */
  autostart?: boolean;
}

/**
 * Options for an individual worker
 */
export interface RunOnceOptions extends SharedOptions {
  /**
   * An identifier for this specific worker; if unset then a random ID will be assigned. Do not assign multiple workers the same worker ID!
   */
  workerId?: string;

  /**
   * If set true, we won't install signal handlers and it'll be up to you to
   * handle graceful shutdown of the worker if the process receives a signal.
   */
  noHandleSignals?: boolean;

  /** Single worker only! */
  concurrency?: 1;
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
   * Task names and handler, e.g. from `getTasks`. Overrides `taskDirectory`
   */
  taskList?: TaskList;

  /**
   * Each file in this directory will be used as a task handler
   */
  taskDirectory?: string;

  /**
   * A crontab string to use instead of reading a crontab file. Overrides
   * `crontabFile`
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
   * behaviours. Overrides `crontabFile`
   */
  parsedCronItems?: Array<ParsedCronItem>;
}

/** Spec for a job created from cron */
export interface CronJob {
  task: string;
  payload: {
    _cron: { ts: string; backfilled?: boolean };
    [key: string]: unknown;
  };
  queueName?: string;
  runAt: string;
  jobKey?: string;
  jobKeyMode: CronItemOptions["jobKeyMode"];
  maxAttempts?: number;
  priority?: number;
}

export interface JobAndCronIdentifier {
  job: CronJob;
  identifier: string;
}
export interface JobAndCronIdentifierWithDetails extends JobAndCronIdentifier {
  known_since: Date;
  last_execution: Date | null;
}

export interface WorkerUtilsOptions extends SharedOptions {}

type BaseEventMap = Record<string, unknown>;
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
  "pool:listen:connecting": { workerPool: WorkerPool; attempts: number };

  /**
   * When a worker pool starts listening for jobs via PG LISTEN
   */
  "pool:listen:success": { workerPool: WorkerPool; client: PoolClient };

  /**
   * When a worker pool faces an error on their PG LISTEN client
   */
  "pool:listen:error": {
    workerPool: WorkerPool;
    error: unknown;
    client: PoolClient;
  };

  /**
   * When a worker pool receives a notification
   */
  "pool:listen:notification": {
    workerPool: WorkerPool;
    message: Notification;
    client: PoolClient;
  };

  /**
   * When a worker pool listening client is no longer available
   */
  "pool:listen:release": {
    workerPool: WorkerPool;
    /** If you use this client, be careful to handle errors - it may be in an invalid state (errored, disconnected, etc). */
    client: PoolClient;
  };

  /**
   * When a worker pool fails to complete/fail a job
   */
  "pool:fatalError": {
    workerPool: WorkerPool;
    error: unknown;
    action: string;
  };

  /**
   * When a worker pool is released
   */
  "pool:release": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
  };

  /**
   * When a worker pool starts a graceful shutdown
   */
  "pool:gracefulShutdown": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
    message: string;
  };

  /**
   * When a worker pool graceful shutdown throws an error
   */
  "pool:gracefulShutdown:error": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
    error: unknown;
  };

  /**
   * When a worker pool graceful shutdown is successful, but one of the workers
   * throws an error from release()
   */
  "pool:gracefulShutdown:workerError": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
    error: unknown;
    job: Job | null;
  };

  /**
   * When a worker pool graceful shutdown throws an error
   */
  "pool:gracefulShutdown:complete": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
  };

  /**
   * When a worker pool starts a forceful shutdown
   */
  "pool:forcefulShutdown": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
    message: string;
  };

  /**
   * When a worker pool forceful shutdown throws an error
   */
  "pool:forcefulShutdown:error": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
    error: unknown;
  };

  /**
   * When a worker pool forceful shutdown throws an error
   */
  "pool:forcefulShutdown:complete": {
    /** @deprecated Use workerPool for consistency */
    pool: WorkerPool;
    workerPool: WorkerPool;
  };

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
  "worker:stop": { worker: Worker; error?: unknown };

  /**
   * When a worker is about to ask the database for a job to execute
   */
  "worker:getJob:start": { worker: Worker };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:error": { worker: Worker; error: unknown };

  /**
   * When a worker calls get_job but there are no available jobs
   */
  "worker:getJob:empty": { worker: Worker };

  /**
   * When a worker is created
   */
  "worker:fatalError": {
    worker: Worker;
    error: unknown;
    jobError: unknown | null;
  };

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
  "job:error": {
    worker: Worker;
    job: Job;
    error: unknown;
    batchJobErrors?: unknown[];
  };

  /**
   * When a job fails permanently (emitted after job:error when appropriate)
   */
  "job:failed": {
    worker: Worker;
    job: Job;
    error: unknown;
    batchJobErrors?: unknown[];
  };

  /**
   * When a job has finished executing and the result (success or failure) has
   * been written back to the database
   */
  "job:complete": { worker: Worker; job: Job; error: unknown };

  /** **Experimental** When the cron starts working (before backfilling) */
  "cron:starting": { cron: Cron; start: Date };

  /** **Experimental** When the cron starts working (after backfilling completes) */
  "cron:started": { cron: Cron; start: Date };

  /** **Experimental** When a number of jobs need backfilling for a particular timestamp. */
  "cron:backfill": {
    cron: Cron;
    itemsToBackfill: JobAndCronIdentifierWithDetails[];
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
   * **Experimental** When we trigger the 'resetLocked' cleanup process
   * (currently every 8-10 minutes)
   */
  "resetLocked:started": {
    /** @internal Not sure this'll stay on pool */
    workerPool: WorkerPool;
  };

  /**
   * **Experimental** When the `resetLocked` process has completed
   * successfully.
   */
  "resetLocked:success": {
    /**
     * The number of milliseconds until resetLocked runs again (or null if we
     * won't because the pool is exiting)
     */
    delay: number | null;

    /** @internal Not sure this'll stay on pool */
    workerPool: WorkerPool;
  };

  /**
   * **Experimental** When the `resetLocked` process has failed.
   */
  "resetLocked:failure": {
    error: Error;

    /**
     * The number of milliseconds until resetLocked runs again (or null if we
     * won't because the pool is exiting)
     */
    delay: number | null;

    /** @internal Not sure this'll stay on pool */
    workerPool: WorkerPool;
  };

  /**
   * When the runner is terminated by a signal
   */
  gracefulShutdown: { signal: Signal };

  /**
   * When the runner is terminated by a signal _again_ after 5 seconds
   */
  forcefulShutdown: { signal: Signal };

  /**
   * When the runner is stopped
   */
  stop: Record<string, never>;
};

export type WorkerEvents = TypedEventEmitter<WorkerEventMap>;

/**
 * The digest of a timestamp into the component parts that a cron schedule cares about.
 */
export interface TimestampDigest {
  min: number;
  hour: number;
  date: number;
  month: number;
  dow: number;
}

/** Details of a file (guaranteed not to be a directory, nor a symlink) */
export interface FileDetails {
  /** The full path to the file (possibly relative to the current working directory) */
  fullPath: string;
  /** The stats of the file */
  stats: Stats;
  /** The name of the file, excluding any extensions */
  baseName: string;
  /** The extensions of the file, e.g. `""` for no extensions, `".js"` or even `".test.js"`. */
  extension: string;
}

export type Writeable<T> = { -readonly [P in keyof T]: T[P] };

export interface WorkerPluginContext {
  version: string;
  maxMigrationNumber: number;
  breakingMigrationNumbers: number[];
  events: WorkerEvents;
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
  /** @internal */
  _rawOptions: SharedOptions;
  hooks: AsyncHooks<GraphileConfig.WorkerHooks>;
  resolvedPreset: ResolvedWorkerPreset;
}
export type GetJobFunction = (
  workerId: string,
  flagsToSkip: string[] | null,
) => PromiseOrDirect<Job | undefined>;

export type CompleteJobFunction = (job: DbJob) => void;
export type FailJobFunction = (spec: {
  job: DbJob;
  message: string;
  replacementPayload: undefined | unknown[];
}) => void;
