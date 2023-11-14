import defer, { Deferred } from "../src/deferred";
import { DbJob, Task, TaskList, WorkerSharedOptions } from "../src/interfaces";
import { runTaskListOnce } from "../src/main";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  getJobQueues,
  getJobs,
  jobCount,
  reset,
  sleepUntil,
  withPgClient,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const options: WorkerSharedOptions = {};

test("runs jobs", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    const start = new Date();
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}', queue_name := 'myqueue')`,
    );

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(+job.run_at).toBeGreaterThanOrEqual(+start);
    expect(+job.run_at).toBeLessThanOrEqual(+new Date());
    const jobQueues = await getJobQueues(pgClient);
    expect(jobQueues).toHaveLength(1);
    const q = jobQueues[0];
    expect(q.queue_name).toEqual(job.queue_name);
    expect(q.job_count).toEqual(1);
    expect(q.locked_at).toBeFalsy();
    expect(q.locked_by).toBeFalsy();

    // Run the task
    const job3: Task = jest.fn((o) => {
      expect(o).toMatchInlineSnapshot(`
        Object {
          "a": 1,
        }
      `);
    });
    const job2: Task = jest.fn();
    const tasks: TaskList = {
      job3,
      job2,
    };
    await runTaskListOnce(options, tasks, pgClient);

    // Job should have been called once only
    expect(job3).toHaveBeenCalledTimes(1);
    expect(job2).not.toHaveBeenCalled();
    expect(await jobCount(pgClient)).toEqual(0);
  }));

test("schedules errors for retry", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    const start = new Date();
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}', queue_name := 'myqueue')`,
    );

    {
      const jobs = await getJobs(pgClient);
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job3");
      expect(job.payload).toEqual({ a: 1 });
      expect(+job.run_at).toBeGreaterThanOrEqual(+start);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date());

      const jobQueues = await getJobQueues(pgClient);
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(q.locked_at).toBeFalsy();
      expect(q.locked_by).toBeFalsy();
    }

    // Run the job (it will fail)
    const job3: Task = jest.fn(() => {
      throw new Error("TEST_ERROR");
    });
    const tasks: TaskList = {
      job3,
    };
    await runTaskListOnce(options, tasks, pgClient);
    expect(job3).toHaveBeenCalledTimes(1);

    // Check that it failed as expected
    {
      const jobs = await getJobs(pgClient);
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job3");
      expect(job.attempts).toEqual(1);
      expect(job.max_attempts).toEqual(25);
      expect(job.last_error).toEqual("TEST_ERROR");
      // It's the first attempt, so delay is exp(1) ~= 2.719 seconds
      expect(+job.run_at).toBeGreaterThanOrEqual(+start + 2718);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date() + 2719);

      const jobQueues = await getJobQueues(pgClient);
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(q.locked_at).toBeFalsy();
      expect(q.locked_by).toBeFalsy();
    }
  }));

test("retries job", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Add the job
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}', queue_name := 'myqueue')`,
    );
    let counter = 0;
    const job3: Task = jest.fn(() => {
      throw new Error(`TEST_ERROR ${++counter}`);
    });
    const tasks: TaskList = {
      job3,
    };

    // Run the job (it will error)
    await runTaskListOnce(options, tasks, pgClient);
    expect(job3).toHaveBeenCalledTimes(1);

    // Should do nothing the second time, because it's queued for the future (assuming we run this fast enough afterwards!)
    await runTaskListOnce(options, tasks, pgClient);
    expect(job3).toHaveBeenCalledTimes(1);

    // Tell the job to be runnable
    await pgClient.query(
      `update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs set run_at = now() where task_identifier = 'job3'`,
    );

    // Run the job
    const start = new Date();
    await runTaskListOnce(options, tasks, pgClient);

    // It should have ran again
    expect(job3).toHaveBeenCalledTimes(2);

    // And it should have been rejected again
    {
      const jobs = await getJobs(pgClient);
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job3");
      expect(job.attempts).toEqual(2);
      expect(job.max_attempts).toEqual(25);
      expect(job.last_error).toEqual("TEST_ERROR 2");
      // It's the second attempt, so delay is exp(2) ~= 7.389 seconds
      expect(+job.run_at).toBeGreaterThanOrEqual(+start + 7388);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date() + 7389);

      const jobQueues = await getJobQueues(pgClient);
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(q.locked_at).toBeFalsy();
      expect(q.locked_by).toBeFalsy();
    }
  }));

test("supports future-scheduled jobs", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Add the job
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('future', run_at := now() + interval '3 seconds')`,
    );
    const future: Task = jest.fn();
    const tasks: TaskList = {
      future,
    };

    // Run all jobs (none are ready)
    await runTaskListOnce(options, tasks, pgClient);
    expect(future).not.toHaveBeenCalled();

    // Still not ready
    await runTaskListOnce(options, tasks, pgClient);
    expect(future).not.toHaveBeenCalled();

    // Tell the job to be runnable
    await pgClient.query(
      `update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs set run_at = now() where task_identifier = 'future'`,
    );

    // Run the job
    await runTaskListOnce(options, tasks, pgClient);

    // It should have ran again
    expect(future).toHaveBeenCalledTimes(1);

    // It should be successful
    {
      const jobs = await getJobs(pgClient);
      expect(jobs).toHaveLength(0);
      const jobQueues = await getJobQueues(pgClient);
      expect(jobQueues).toHaveLength(0);
    }
  }));

test("allows update of pending jobs", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const job3: Task = jest.fn((o) => {
      expect(o).toMatchObject({ a: "right" });
    });
    const tasks: TaskList = {
      job3,
    };

    // Schedule a future job - note incorrect payload
    const runAt = new Date();
    runAt.setSeconds(runAt.getSeconds() + 60);

    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "wrong"}', run_at := '${runAt.toISOString()}', job_key := 'abc')`,
    );

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.run_at).toEqual(runAt);

    // Run all jobs (none are ready)
    await runTaskListOnce(options, tasks, pgClient);
    expect(job3).not.toHaveBeenCalled();

    // update the job to run immediately with correct payload
    const now = new Date();
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "right"}', run_at := '${now.toISOString()}', job_key := 'abc')`,
    );

    // Assert that it has updated the existing entry and not created a new one
    const updatedJobs = await getJobs(pgClient);
    expect(updatedJobs).toHaveLength(1);
    const updatedJob = updatedJobs[0];
    expect(updatedJob.id).toEqual(job.id);
    expect(updatedJob.run_at).toEqual(now);

    // Run the task
    await runTaskListOnce(options, tasks, pgClient);
    expect(tasks.job3).toHaveBeenCalledTimes(1);
  }));

test("schedules a new job if existing is completed", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const tasks: TaskList = {
      job3: jest.fn(async () => {}),
    };

    // Schedule a job to run immediately
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "first"}', job_key := 'abc')`,
    );

    // run the job
    await runTaskListOnce(options, tasks, pgClient);
    expect(tasks.job3).toHaveBeenCalledTimes(1);

    // attempt to update the job - it should schedule a new one instead
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "second"}',  job_key := 'abc')`,
    );

    // run again
    await runTaskListOnce(options, tasks, pgClient);
    expect(tasks.job3).toHaveBeenCalledTimes(2);

    // check jobs ran in the right order
    expect(tasks.job3).toHaveBeenNthCalledWith(
      1,
      { a: "first" },
      expect.any(Object),
    );
    expect(tasks.job3).toHaveBeenNthCalledWith(
      2,
      { a: "second" },
      expect.any(Object),
    );
  }));

test("schedules a new job if existing is being processed", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const defers: Deferred[] = [];
    try {
      const tasks: TaskList = {
        job3: jest.fn(async () => {
          const deferred = defer();
          defers.push(deferred);
          return deferred;
        }),
      };

      // Schedule a job to run immediately
      await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "first"}', job_key := 'abc')`,
      );

      // run the job
      const promise = runTaskListOnce(options, tasks, pgClient);

      // wait for it to be picked up for processing
      await sleepUntil(() => defers.length > 0);
      expect(tasks.job3).toHaveBeenCalledTimes(1);

      // attempt to update the job - it should schedule a new one instead
      await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "second"}',  job_key := 'abc')`,
      );

      // check there are now two jobs scheduled
      expect(await getJobs(pgClient)).toHaveLength(2);

      // wait for the original job to complete - note this picks up the new job,
      // because the worker checks again for pending jobs at the end of each run
      defers[0].resolve(); // complete first job
      await sleepUntil(() => defers.length > 1); // wait for second job to be picked up
      defers[1].resolve(); // complete second job
      await promise; // wait for all jobs to finish

      expect(tasks.job3).toHaveBeenCalledTimes(2);

      // check jobs ran in the right order
      expect(tasks.job3).toHaveBeenNthCalledWith(
        1,
        { a: "first" },
        expect.any(Object),
      );
      expect(tasks.job3).toHaveBeenNthCalledWith(
        2,
        { a: "second" },
        expect.any(Object),
      );
    } finally {
      defers.forEach((d) => d.resolve());
    }
  }));

test("schedules a new job if the existing is pending retry", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const tasks: TaskList = {
      job5: jest.fn(async (o: { succeed: boolean }) => {
        if (!o.succeed) {
          throw new Error("TEST_ERROR");
        }
      }),
    };

    // Schedule a job failure
    const {
      rows: [initialJob],
    } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job5', '{"succeed": false}', job_key := 'abc')`,
    );

    // run the job
    await runTaskListOnce(options, tasks, pgClient);
    expect(tasks.job5).toHaveBeenCalledTimes(1);

    // Check that it failed as expected and retry has been scheduled
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toEqual(initialJob.id);
    expect(jobs[0].attempts).toEqual(1);
    expect(jobs[0].last_error).toEqual("TEST_ERROR");
    expect(+jobs[0].run_at).toBeGreaterThanOrEqual(+initialJob.run_at + 200);

    // run again - nothing should happen
    await runTaskListOnce(options, tasks, pgClient);
    expect(tasks.job5).toHaveBeenCalledTimes(1);

    // update the job to succeed
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job5', '{"succeed": true}',  job_key := 'abc')`,
    );

    // Assert that it has updated the existing entry and not created a new one
    const updatedJobs = await getJobs(pgClient);
    expect(updatedJobs).toHaveLength(1);
    expect(updatedJobs[0].id).toEqual(initialJob.id);
    expect(updatedJobs[0].attempts).toEqual(0);
    expect(updatedJobs[0].last_error).toEqual(null);

    // run again - now it should happen immediately due to the update
    await runTaskListOnce(options, tasks, pgClient);
    expect(tasks.job5).toHaveBeenCalledTimes(2);

    // check jobs ran in the right order
    expect(tasks.job5).toHaveBeenNthCalledWith(
      1,
      { succeed: false },
      expect.any(Object),
    );
    expect(tasks.job5).toHaveBeenNthCalledWith(
      2,
      { succeed: true },
      expect.any(Object),
    );
  }));

test("job details are reset if not specified in update", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a future job
    const runAt = new Date();
    runAt.setSeconds(runAt.getSeconds() + 3);
    const {
      rows: [original],
    } = await pgClient.query<DbJob>(
      `
select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job(
  'job3',
  '{"a": 1}',
  queue_name := 'queue1',
  run_at := '${runAt.toISOString()}',
  max_attempts := 10,
  job_key := 'abc'
) jobs`,
    );

    expect(original).toMatchObject({
      attempts: 0,
      key: "abc",
      last_error: null,
      max_attempts: 10,
      payload: {
        a: 1,
      },
      queue_name: "queue1",
      run_at: runAt,
      task_identifier: "job3",
    });

    // Assert that it has an entry in jobs
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject(original);

    // update job, but don't provide any new details
    await pgClient.query(
      `\
select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job(
  'job3',
  job_key := 'abc'
)`,
    );

    // check omitted details have reverted to the default values, bar queue name
    // which should not change unless explicitly updated
    const jobs2 = await getJobs(pgClient);
    expect(jobs2).toHaveLength(1);
    expect(jobs2[0]).toMatchObject({
      id: original.id,
      attempts: 0,
      key: "abc",
      last_error: null,
      max_attempts: 25,
      payload: {},
      task_identifier: "job3",
      queue_name: null,
    });

    // update job with new details
    const runAt2 = new Date();
    runAt2.setSeconds(runAt.getSeconds() + 5);
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job(
        'job2',
        '{"a": 2}',
        queue_name := 'queue2',
        run_at := '${runAt2.toISOString()}',
        max_attempts := 100,
        job_key := 'abc'
      )`,
    );

    // check details have changed
    const jobs3 = await getJobs(pgClient);
    expect(jobs3).toHaveLength(1);
    expect(jobs3[0]).toMatchObject({
      id: original.id,
      attempts: 0,
      last_error: null,
      key: "abc",
      max_attempts: 100,
      payload: {
        a: 2,
      },
      queue_name: "queue2",
      run_at: runAt2,
      task_identifier: "job2",
    });
  }));

test("pending jobs can be removed", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": "1"}', job_key := 'abc')`,
    );

    // Assert that it has an entry in jobs / job_queues
    expect(await getJobs(pgClient)).toHaveLength(1);

    // remove the job
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.remove_job('abc')`,
    );
    // check there are no jobs
    expect(await getJobs(pgClient)).toHaveLength(0);
  }));

test("jobs in progress cannot be removed", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    let deferred: Deferred | null = null;

    try {
      const tasks: TaskList = {
        job3: jest.fn(async () => {
          deferred = defer();
          return deferred;
        }),
      };

      // Schedule a job
      await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 123}', job_key := 'abc')`,
      );

      // check it was inserted
      expect(await getJobs(pgClient)).toHaveLength(1);

      const promise = runTaskListOnce(options, tasks, pgClient);
      // wait for it to be picked up for processing
      await sleepUntil(() => !!deferred);
      expect(tasks.job3).toHaveBeenCalledTimes(1);

      // attempt to remove the job
      await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.remove_job('abc')`,
      );

      // check it was not removed
      expect(await getJobs(pgClient)).toHaveLength(1);

      // wait for the original job to complete
      deferred!.resolve();
      await promise;

      expect(tasks.job3).toHaveBeenCalledTimes(1);
      expect(tasks.job3).toHaveBeenCalledWith({ a: 123 }, expect.any(Object));
    } finally {
      if (deferred) {
        (deferred as Deferred).resolve();
      }
    }
  }));

test("runs jobs asynchronously", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    const start = new Date();
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}', queue_name := 'myqueue')`,
    );

    // Run the task
    let jobPromise: Deferred | null = null;
    try {
      const job3: Task = jest.fn(() => {
        jobPromise = defer();
        return jobPromise;
      });
      const tasks: TaskList = {
        job3,
      };
      const workerPool = runTaskListOnce(options, tasks, pgClient);
      let executed = false;
      workerPool.then(() => {
        executed = true;
      });

      await sleepUntil(() => !!jobPromise);

      const worker = workerPool.worker!;
      expect(worker).toBeTruthy();

      // Job should have been called once only
      expect(jobPromise).toBeTruthy();
      expect(job3).toHaveBeenCalledTimes(1);

      expect(executed).toBeFalsy();

      {
        const jobs = await getJobs(pgClient);
        expect(jobs).toHaveLength(1);
        const job = jobs[0];
        expect(job.task_identifier).toEqual("job3");
        expect(job.payload).toEqual({ a: 1 });
        expect(+job.run_at).toBeGreaterThanOrEqual(+start);
        expect(+job.run_at).toBeLessThanOrEqual(+new Date());
        expect(job.attempts).toEqual(1); // It gets increased when the job is checked out

        const jobQueues = await getJobQueues(pgClient);
        expect(jobQueues).toHaveLength(1);
        const q = jobQueues[0];
        expect(q.queue_name).toEqual(job.queue_name);
        expect(q.job_count).toEqual(1);
        expect(+q.locked_at).toBeGreaterThanOrEqual(+start);
        expect(+q.locked_at).toBeLessThanOrEqual(+new Date());
        expect(q.locked_by).toEqual(worker.workerId);
      }

      jobPromise!.resolve();
      await workerPool;
      expect(executed).toBeTruthy();

      // Job should have been called once only
      expect(job3).toHaveBeenCalledTimes(1);
      expect(await jobCount(pgClient)).toEqual(0);
    } finally {
      if (jobPromise) {
        (jobPromise as Deferred).resolve();
      }
    }
  }));

test("runs jobs in parallel", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule 5 jobs
    const start = new Date();
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}', queue_name := 'queue_' || s::text) from generate_series(1, 5) s`,
    );

    // Run the task
    const jobPromises: Array<Deferred> = [];
    try {
      const job3: Task = jest.fn(() => {
        const jobPromise = defer();
        jobPromises.push(jobPromise);
        return jobPromise;
      });
      const tasks: TaskList = {
        job3,
      };
      const runPromises = [
        runTaskListOnce(options, tasks, pgClient),
        runTaskListOnce(options, tasks, pgClient),
        runTaskListOnce(options, tasks, pgClient),
        runTaskListOnce(options, tasks, pgClient),
        runTaskListOnce(options, tasks, pgClient),
      ];
      let executed = false;
      Promise.all(runPromises).then(() => {
        executed = true;
      });

      await sleepUntil(() => jobPromises.length >= 5);

      // Job should have been called once for each task
      expect(jobPromises).toHaveLength(5);
      expect(job3).toHaveBeenCalledTimes(5);

      expect(executed).toBeFalsy();

      {
        const jobs = await getJobs(pgClient);
        expect(jobs).toHaveLength(5);
        jobs.forEach((job) => {
          expect(job.task_identifier).toEqual("job3");
          expect(job.payload).toEqual({ a: 1 });
          expect(+job.run_at).toBeGreaterThanOrEqual(+start);
          expect(+job.run_at).toBeLessThanOrEqual(+new Date());
          expect(job.attempts).toEqual(1); // It gets increased when the job is checked out
        });

        const jobQueues = await getJobQueues(pgClient);
        expect(jobQueues).toHaveLength(5);
        const locks: Array<string> = [];
        jobQueues.forEach((q) => {
          const job = jobs.find((j) => j.queue_name === q.queue_name);
          expect(job).toBeTruthy();
          expect(q.job_count).toEqual(1);
          expect(+q.locked_at).toBeGreaterThanOrEqual(+start);
          expect(+q.locked_at).toBeLessThanOrEqual(+new Date());
          expect(locks.indexOf(q.locked_by)).toEqual(-1);
          locks.push(q.locked_by);
        });
        expect(locks.length).toEqual(5);
      }

      expect(executed).toBeFalsy();
      jobPromises.forEach((jobPromise) => jobPromise!.resolve());
      await Promise.all(runPromises);
      expect(executed).toBeTruthy();

      // Job should not have been called any more times
      expect(job3).toHaveBeenCalledTimes(5);
      expect(await jobCount(pgClient)).toEqual(0);
    } finally {
      jobPromises.forEach((jobPromise) => jobPromise!.resolve());
    }
  }));

test("single worker runs jobs in series, purges all before exit", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule 5 jobs
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}') from generate_series(1, 5)`,
    );

    // Run the task
    const jobPromises: Array<Deferred> = [];
    try {
      const job3: Task = jest.fn(() => {
        const jobPromise = defer();
        jobPromises.push(jobPromise);
        return jobPromise;
      });
      const tasks: TaskList = {
        job3,
      };
      const workerPool = runTaskListOnce(options, tasks, pgClient);
      let executed = false;
      workerPool.then(() => {
        executed = true;
      });

      for (let i = 0; i < 5; i++) {
        await sleepUntil(() => jobPromises.length >= i + 1);
        expect(jobPromises).toHaveLength(i + 1);
        expect(job3).toHaveBeenCalledTimes(i + 1);

        // Shouldn't be finished yet
        expect(executed).toBeFalsy();

        // Complete this job, on to the next one
        jobPromises[i].resolve();
      }

      expect(jobPromises).toHaveLength(5);
      expect(job3).toHaveBeenCalledTimes(5);

      await workerPool;
      expect(executed).toBeTruthy();

      // Job should not have been called any more times
      expect(job3).toHaveBeenCalledTimes(5);
      expect(await jobCount(pgClient)).toEqual(0);
    } finally {
      jobPromises.forEach((p) => p.resolve());
    }
  }));

test("jobs added to the same queue will be ran serially (even if multiple workers)", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule 5 jobs
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '{"a": 1}', 'serial') from generate_series(1, 5)`,
    );

    // Run the task
    const jobPromises: Array<Deferred> = [];
    try {
      const job3: Task = jest.fn(() => {
        const jobPromise = defer();
        jobPromises.push(jobPromise);
        return jobPromise;
      });
      const tasks: TaskList = {
        job3,
      };
      const runPromises = [
        runTaskListOnce(options, tasks, pgClient),
        runTaskListOnce(options, tasks, pgClient),
        runTaskListOnce(options, tasks, pgClient),
      ];
      let executed = false;
      Promise.all(runPromises).then(() => {
        executed = true;
      });

      for (let i = 0; i < 5; i++) {
        // Give the other workers a chance to interfere (they shouldn't)
        await sleep(50);

        await sleepUntil(() => jobPromises.length >= i + 1);
        expect(jobPromises).toHaveLength(i + 1);
        expect(job3).toHaveBeenCalledTimes(i + 1);

        // Shouldn't be finished yet
        expect(executed).toBeFalsy();

        // Complete this job, on to the next one
        jobPromises[i].resolve();
      }

      expect(jobPromises).toHaveLength(5);
      expect(job3).toHaveBeenCalledTimes(5);

      await Promise.all(runPromises);
      expect(executed).toBeTruthy();

      // Job should not have been called any more times
      expect(job3).toHaveBeenCalledTimes(5);
      expect(await jobCount(pgClient)).toEqual(0);
    } finally {
      jobPromises.forEach((p) => p.resolve());
    }
  }));
