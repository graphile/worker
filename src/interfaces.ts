import { PoolClient, Pool } from "pg";
import { IDebugger } from "./debug";

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
 */

export type WithPgClient = <T = void>(
  callback: (pgClient: PoolClient) => Promise<T>
) => Promise<T>;

export interface Helpers {
  job: Job;
  debug: IDebugger;
  withPgClient: WithPgClient;
  addJob(
    identifier: string,
    payload?: any,
    options?: TaskOptions
  ): Promise<Job>;
}

export type Task = (payload: unknown, helpers: Helpers) => void | Promise<void>;

export function isValidTask(fn: any): fn is Task {
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

export interface Job {
  id: number;
  queue_name: string;
  task_identifier: string;
  payload: unknown;
  priority: number;
  run_at: Date;
  attempts: number;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
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

export interface TaskOptions {
  /**
   * the queue to run this task under
   */
  queueName?: string;
  /**
   * a Date to schedule this task to run in the future
   */
  runAt?: Date;
  /**
   * how many retries should this task get? (Default: 25)
   */
  maxAttempts?: number;
}

export interface WorkerOptions {
  pollInterval?: number;
  workerId?: string;
}

export interface WorkerPoolOptions extends WorkerOptions {
  workerCount?: number;
}

export interface initWorkerOptions {
  /**
   * number of jobs to run concurrently
   */
  jobs?: number;
  /**
   * how long to wait between polling for jobs in milliseconds (for jobs scheduled in the future/retries)
   */
  pollInterval?: number;
  /**
   * task names and handler
   */
  taskList?: TaskList;
  /**
   * each file in this directory will be used as a task handler
   */
  taskDirectory?: string;
}

export interface WorkerConstructorOptions {
  jobs: number;
  pollInterval: number;
  taskList: TaskList;
  pgPool: Pool;
}

/**
 * A narrower type than `any` that won’t swallow errors from assumptions about
 * code.
 *
 * For example `(x as any).anything()` is ok. That function then returns `any`
 * as well so the problem compounds into `(x as any).anything().else()` and the
 * problem just goes from there. `any` is a type black hole that swallows any
 * useful type information and shouldn’t be used unless you know what you’re
 * doing.
 *
 * With `mixed` you must *prove* the type is what you want to use.
 *
 * The `mixed` type is identical to the `mixed` type in Flow.
 *
 * @see https://github.com/Microsoft/TypeScript/issues/9999
 * @see https://flowtype.org/docs/builtins.html#mixed
 */
export type mixed = {} | string | number | boolean | undefined | null;
