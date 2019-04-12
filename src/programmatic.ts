import * as assert from "assert";
import { Pool, PoolConfig } from 'pg';

import getTasks from "./getTasks";
import { WorkerConstructorOptions, TaskList, initWorkerOptions, WorkerPool, WithPgClient, TaskOptions, Job } from './interfaces';
import { POLL_INTERVAL, CONCURRENT_JOBS } from './config';
import { runTaskList } from './main';
import { makeWithPgClientFromPool, makeAddJob } from './helpers';
import { migrate } from './migrate';
import toPgPool from './toPgPool';

// We are using a factory function because the taskList fetching is asynchronous
// and cannot be executed in the sync constructor of class Worker
export const initWorker = async (
  poolOrConfig?: Pool | PoolConfig | string,
  {
    jobs = CONCURRENT_JOBS,
    pollInterval = POLL_INTERVAL,
    taskDirectory,
    taskList,
  }: initWorkerOptions = {}
) => {
  assert(typeof poolOrConfig !== 'undefined', 'The first argument to graphile-worker was `undefined`... did you mean to set pool options?');

  // Do some things with `poolOrConfig` so that in the end, we actually get a
  // Postgres pool.
  const pgPool = toPgPool(poolOrConfig);

  assert(typeof jobs === 'number' && jobs >= 1, 'jobs option should be a valid number greater or equal to 1');
  assert(typeof pollInterval === 'number' && pollInterval >= 0, 'pollInterval option should be a valid number greater than 0');

  assert((taskDirectory && !taskList) || (!taskDirectory && taskList), 'Exactly one of either taskDirectory or taskList should be set');
  const tasks = taskDirectory
    ? (await getTasks(taskDirectory)).tasks
    // taskList is treated as it could be undefined by TS but we checked it in the assert above
    // so we need to cast it to prevent an error
    : taskList as TaskList;

  // Installing all migrations including tables and functions to handle jobs
  const withPgClient = makeWithPgClientFromPool(pgPool)
  await withPgClient(client => migrate(client));

  return new Worker({
    pgPool, taskList: tasks, jobs, pollInterval
  });
}

export class Worker {
  pgPool: Pool;
  jobs: number;
  pollInterval: number;
  taskList: TaskList;
  workerPool: WorkerPool | undefined;
  withPgClient: WithPgClient;

  addJob: (identifier: string, payload?: any, options?: TaskOptions) => Promise<Job>;

  constructor({
    jobs,
    pollInterval,
    pgPool,
    taskList,
  }: WorkerConstructorOptions) {
    this.jobs = jobs;
    this.pollInterval = pollInterval;
    this.pgPool = pgPool,
    this.taskList = taskList;
    this.withPgClient = makeWithPgClientFromPool(this.pgPool)
    this.addJob = makeAddJob(this.withPgClient);
  }

  start() {
    if (this.workerPool) {
      throw new Error('Worker was already started');
    }
    this.workerPool = runTaskList(this.taskList, this.pgPool, {
      workerCount: this.jobs,
      pollInterval: this.pollInterval,
    });
  }

  async stop() {
    if (!this.workerPool) {
      throw new Error('Worker is already stopped');
    }
    await this.workerPool.release();
    this.workerPool = undefined;
  }
}
