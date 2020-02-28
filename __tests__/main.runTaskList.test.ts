// See also main.runTaskListOnce.test.ts
import {
  reset,
  withPgPool,
  sleepUntil,
  sleep,
  jobCount,
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
} from "./helpers";
import { TaskList, Task, WorkerSharedOptions } from "../src/interfaces";
import { runTaskList } from "../src/main";
import deferred, { Deferred } from "../src/deferred";
import { Pool } from "pg";

const addJob = (pgPool: Pool, id?: string | number) =>
  pgPool.query(
    `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), 'serial')`,
    [String(id != null ? id : Math.random())]
  );

const options: WorkerSharedOptions = {};

test("main will execute jobs as they come up, and exits cleanly", () =>
  withPgPool(async pgPool => {
    await reset(pgPool, options);

    // Build the tasks
    const jobPromises: {
      [id: string]: Deferred;
    } = {};
    const job1: Task = jest.fn(({ id }: { id: string }) => {
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
    const workerPool = runTaskList(tasks, pgPool, { concurrency: 3 });
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
      jobPromises[i].resolve();
    }

    await sleep(1);
    expect(finished).toBeFalsy();
    await workerPool.release();
    expect(job1).toHaveBeenCalledTimes(5);
    await sleep(1);
    expect(finished).toBeTruthy();
    await workerPool.promise;
    expect(await jobCount(pgPool)).toEqual(0);
  }));

test("doesn't bail on deprecated `debug` function", () =>
  withPgPool(async pgPool => {
    await reset(pgPool, options);
    let jobPromise: Deferred | null = null;
    const tasks: TaskList = {
      job1(payload, helpers) {
        // @ts-ignore Not officially supported
        helpers.debug("Hey %o", payload);
        jobPromise = deferred();
      },
    };
    const workerPool = runTaskList(tasks, pgPool, { concurrency: 3 });
    await addJob(pgPool);
    await sleepUntil(() => !!jobPromise);
    jobPromise!.resolve();
    await workerPool.release();
  }));
