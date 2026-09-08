// See also main.runTaskListOnce.test.ts
import { jest } from "@jest/globals";
import type { Pool } from "pg";

import type { Deferred } from "../src/deferred.ts";
import deferred from "../src/deferred.ts";
import type {
  Job,
  Task,
  TaskList,
  WorkerSharedOptions,
} from "../src/interfaces.ts";
import { runTaskList } from "../src/main.ts";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  expectJobCount,
  getJobs,
  reset,
  sleep,
  sleepUntil,
  withPgPool,
} from "./helpers.ts";

const addJob = (pgPool: Pool, id?: string | number) =>
  pgPool.query(
    `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), 'serial')`,
    [String(id != null ? id : Math.random())],
  );

const options: WorkerSharedOptions = {};

test("main will execute jobs as they come up, and exits cleanly", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    // Build the tasks
    const jobPromises: {
      [id: string]: Deferred | undefined;
    } = {};
    try {
      const job1: Task<"job1"> = jest.fn(({ id }) => {
        const jobPromise = deferred();
        if (jobPromises[id]) {
          throw new Error("Job with this id already registered");
        }
        jobPromises[id] = jobPromise;
        return jobPromise;
      });
      const tasks: TaskList = {
        job1,
      };

      // Run the worker
      expect(process.listeners("SIGTERM")).toHaveLength(0);
      const workerPool = runTaskList({ concurrency: 3 }, tasks, pgPool);
      expect(process.listeners("SIGTERM")).toHaveLength(1);
      let finished = false;
      workerPool.promise.then(() => {
        finished = true;
      });

      for (let i = 0; i < 5; i++) {
        expect(Object.keys(jobPromises).length).toEqual(i);

        await addJob(pgPool, i);
        await sleepUntil(() => !!jobPromises[i]);

        expect(Object.keys(jobPromises).length).toEqual(i + 1);

        // Resolve this job so the next can start
        jobPromises[i]!.resolve();
      }

      await sleep(1);
      expect(finished).toBeFalsy();
      await workerPool.gracefulShutdown();
      expect(job1).toHaveBeenCalledTimes(5);
      await sleep(1);
      expect(finished).toBeTruthy();
      await workerPool.promise;
      await expectJobCount(pgPool, 0);
      expect(process.listeners("SIGTERM")).toHaveLength(0);
    } finally {
      Object.values(jobPromises).forEach((p) => p?.resolve());
    }
  }));

test("doesn't bail on deprecated `debug` function", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);
    let jobPromise: Deferred | null = null;
    try {
      const tasks: TaskList = {
        job1(payload, helpers) {
          // @ts-ignore Not officially supported
          helpers.debug("Hey %o", payload);
          jobPromise = deferred();
        },
      };
      const workerPool = runTaskList({ concurrency: 3 }, tasks, pgPool);
      await addJob(pgPool);
      await sleepUntil(() => !!jobPromise);
      jobPromise!.resolve();
      await workerPool.gracefulShutdown();
    } finally {
      if (jobPromise) {
        (jobPromise as Deferred).resolve();
      }
    }
  }));

test("gracefulShutdown", async () =>
  withPgPool(async (pgPool) => {
    let jobStarted = false;
    const tasks: TaskList = {
      job1(payload, helpers) {
        jobStarted = true;
        return Promise.race([sleep(100000, true), helpers.abortPromise]);
      },
    };
    const workerPool = runTaskList(
      { concurrency: 3, gracefulShutdownAbortTimeout: 20, useNodeTime: true },
      tasks,
      pgPool,
    );
    await addJob(pgPool);
    await sleepUntil(() => jobStarted);
    await workerPool.gracefulShutdown();
    await workerPool.promise;
    let jobs: Job[] = [];
    for (let attempts = 0; attempts < 10; attempts++) {
      jobs = await getJobs(pgPool);
      if (jobs[0]?.last_error) {
        break;
      } else {
        await sleep(25 * attempts);
      }
    }
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job.last_error).toBeTruthy();
  }));

test("jobs in the same named queue run serially even when the local queue is enabled", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const jobPromises: Deferred[] = [];
    try {
      const job1: Task<"job1"> = jest.fn(() => {
        const jobPromise = deferred();
        jobPromises.push(jobPromise);
        return jobPromise;
      });
      const tasks: TaskList = {
        job1,
      };

      // A backlog of 5 jobs in the same named queue, before the pool starts
      for (let i = 0; i < 5; i++) {
        await addJob(pgPool, i);
      }

      const workerPool = runTaskList(
        {
          concurrency: 4,
          preset: { worker: { localQueue: { size: 5 }, pollInterval: 10 } },
        },
        tasks,
        pgPool,
      );

      for (let i = 0; i < 5; i++) {
        await sleepUntil(() => jobPromises.length >= i + 1);
        // Give the pool a chance to (incorrectly) hand more jobs from the
        // same queue to the other, idle workers
        await sleep(50);
        expect(jobPromises).toHaveLength(i + 1);

        // Complete this job, on to the next one
        jobPromises[i].resolve();
      }

      await workerPool.gracefulShutdown();
      await expectJobCount(pgPool, 0);
    } finally {
      jobPromises.forEach((p) => p.resolve());
    }
  }));

test("jobs in different named queues run in parallel when the local queue is enabled", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const started: string[] = [];
    const jobPromisesById: Record<string, Deferred> = {};
    try {
      const job1: Task<"job1"> = jest.fn(({ id }) => {
        const jobPromise = deferred();
        jobPromisesById[id] = jobPromise;
        started.push(id);
        return jobPromise;
      });
      const tasks: TaskList = {
        job1,
      };

      const addJobToQueue = (id: string, queueName: string) =>
        pgPool.query(
          `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), $2::text)`,
          [id, queueName],
        );
      await addJobToQueue("a1", "queue_a");
      await addJobToQueue("b1", "queue_b");
      await addJobToQueue("a2", "queue_a");
      await addJobToQueue("b2", "queue_b");

      const workerPool = runTaskList(
        {
          concurrency: 4,
          preset: { worker: { localQueue: { size: 5 }, pollInterval: 10 } },
        },
        tasks,
        pgPool,
      );

      // The first job of each queue should run concurrently...
      await sleepUntil(() => started.length >= 2);
      await sleep(50);
      expect([...started].sort()).toEqual(["a1", "b1"]);

      // ...but each queue's second job must wait for its first to complete
      jobPromisesById["a1"].resolve();
      jobPromisesById["b1"].resolve();
      await sleepUntil(() => started.length >= 4);
      expect([...started].sort()).toEqual(["a1", "a2", "b1", "b2"]);
      jobPromisesById["a2"].resolve();
      jobPromisesById["b2"].resolve();

      await workerPool.gracefulShutdown();
      await expectJobCount(pgPool, 0);
    } finally {
      Object.values(jobPromisesById).forEach((p) => p.resolve());
    }
  }));
