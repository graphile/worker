// See also main.runTaskListOnce.test.ts
import { Pool } from "pg";

import deferred, { Deferred } from "../src/deferred";
import { Task, TaskList, WorkerSharedOptions } from "../src/interfaces";
import { runTaskList } from "../src/main";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  expectJobCount,
  jobCount,
  reset,
  sleep,
  sleepUntil,
  withPgPool,
} from "./helpers";

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
