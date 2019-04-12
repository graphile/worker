import { withPgClient, reset, sleepUntil, jobCount } from "./helpers";
import { TaskList, Task, Worker } from "../src/interfaces";
import { runTaskListOnce } from "../src/main";
import deferred, { Deferred } from "../src/deferred";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("runs jobs", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule a job
    const start = new Date();
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(+job.run_at).toBeGreaterThanOrEqual(+start);
    expect(+job.run_at).toBeLessThanOrEqual(+new Date());
    const { rows: jobQueues } = await pgClient.query(
      `select * from graphile_worker.job_queues`
    );
    expect(jobQueues).toHaveLength(1);
    const q = jobQueues[0];
    expect(q.queue_name).toEqual(job.queue_name);
    expect(q.job_count).toEqual(1);
    expect(q.locked_at).toBeFalsy();
    expect(q.locked_by).toBeFalsy();

    // Run the task
    const job1: Task = jest.fn(o => {
      expect(o).toMatchInlineSnapshot(`
Object {
  "a": 1,
}
`);
    });
    const job2: Task = jest.fn();
    const tasks: TaskList = {
      job1,
      job2
    };
    await runTaskListOnce(tasks, pgClient);

    // Job should have been called once only
    expect(job1).toHaveBeenCalledTimes(1);
    expect(job2).not.toHaveBeenCalled();
    expect(await jobCount(pgClient)).toEqual(0);
  }));

test("schedules errors for retry", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule a job
    const start = new Date();
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);

    {
      const { rows: jobs } = await pgClient.query(
        `select * from graphile_worker.jobs`
      );
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job1");
      expect(job.payload).toEqual({ a: 1 });
      expect(+job.run_at).toBeGreaterThanOrEqual(+start);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date());

      const { rows: jobQueues } = await pgClient.query(
        `select * from graphile_worker.job_queues`
      );
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(q.locked_at).toBeFalsy();
      expect(q.locked_by).toBeFalsy();
    }

    // Run the job (it will fail)
    const job1: Task = jest.fn(() => {
      throw new Error("TEST_ERROR");
    });
    const tasks: TaskList = {
      job1
    };
    await runTaskListOnce(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);

    // Check that it failed as expected
    {
      const { rows: jobs } = await pgClient.query(
        `select * from graphile_worker.jobs`
      );
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job1");
      expect(job.attempts).toEqual(1);
      expect(job.max_attempts).toEqual(25);
      expect(job.last_error).toEqual("TEST_ERROR");
      // It's the first attempt, so delay is exp(1) ~= 2.719 seconds
      expect(+job.run_at).toBeGreaterThanOrEqual(+start + 2718);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date() + 2719);

      const { rows: jobQueues } = await pgClient.query(
        `select * from graphile_worker.job_queues`
      );
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(q.locked_at).toBeFalsy();
      expect(q.locked_by).toBeFalsy();
    }
  }));

test("retries job", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Add the job
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);
    let counter = 0;
    const job1: Task = jest.fn(() => {
      throw new Error(`TEST_ERROR ${++counter}`);
    });
    const tasks: TaskList = {
      job1
    };

    // Run the job (it will error)
    await runTaskListOnce(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);

    // Should do nothing the second time, because it's queued for the future (assuming we run this fast enough afterwards!)
    await runTaskListOnce(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);

    // Tell the job to be runnable
    await pgClient.query(
      `update graphile_worker.jobs set run_at = now() where task_identifier = 'job1'`
    );

    // Run the job
    const start = new Date();
    await runTaskListOnce(tasks, pgClient);

    // It should have ran again
    expect(job1).toHaveBeenCalledTimes(2);

    // And it should have been rejected again
    {
      const { rows: jobs } = await pgClient.query(
        `select * from graphile_worker.jobs`
      );
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job1");
      expect(job.attempts).toEqual(2);
      expect(job.max_attempts).toEqual(25);
      expect(job.last_error).toEqual("TEST_ERROR 2");
      // It's the second attempt, so delay is exp(2) ~= 7.389 seconds
      expect(+job.run_at).toBeGreaterThanOrEqual(+start + 7388);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date() + 7389);

      const { rows: jobQueues } = await pgClient.query(
        `select * from graphile_worker.job_queues`
      );
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(q.locked_at).toBeFalsy();
      expect(q.locked_by).toBeFalsy();
    }
  }));

test("supports future-scheduled jobs", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Add the job
    await pgClient.query(
      `select graphile_worker.add_job('future', run_at := now() + interval '3 seconds')`
    );
    const future: Task = jest.fn();
    const tasks: TaskList = {
      future
    };

    // Run all jobs (none are ready)
    await runTaskListOnce(tasks, pgClient);
    expect(future).not.toHaveBeenCalled();

    // Still not ready
    await runTaskListOnce(tasks, pgClient);
    expect(future).not.toHaveBeenCalled();

    // Tell the job to be runnable
    await pgClient.query(
      `update graphile_worker.jobs set run_at = now() where task_identifier = 'future'`
    );

    // Run the job
    await runTaskListOnce(tasks, pgClient);

    // It should have ran again
    expect(future).toHaveBeenCalledTimes(1);

    // It should be successful
    {
      const { rows: jobs } = await pgClient.query(
        `select * from graphile_worker.jobs`
      );
      expect(jobs).toHaveLength(0);
      const { rows: jobQueues } = await pgClient.query(
        `select * from graphile_worker.job_queues`
      );
      expect(jobQueues).toHaveLength(0);
    }
  }));

test("runs jobs asynchronously", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule a job
    const start = new Date();
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);

    // Run the task
    let jobPromise: Deferred<void> | null = null;
    const job1: Task = jest.fn(() => {
      jobPromise = deferred();
      return jobPromise;
    });
    const tasks: TaskList = {
      job1
    };
    const runPromise = runTaskListOnce(tasks, pgClient);
    const worker: Worker = runPromise["worker"];
    expect(worker).toBeTruthy();
    let executed = false;
    runPromise.then(() => {
      executed = true;
    });

    await sleepUntil(() => !!jobPromise);

    // Job should have been called once only
    expect(jobPromise).toBeTruthy();
    expect(job1).toHaveBeenCalledTimes(1);

    expect(executed).toBeFalsy();

    {
      const { rows: jobs } = await pgClient.query(
        `select * from graphile_worker.jobs`
      );
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      expect(job.task_identifier).toEqual("job1");
      expect(job.payload).toEqual({ a: 1 });
      expect(+job.run_at).toBeGreaterThanOrEqual(+start);
      expect(+job.run_at).toBeLessThanOrEqual(+new Date());
      expect(job.attempts).toEqual(1); // It gets increased when the job is checked out

      const { rows: jobQueues } = await pgClient.query(
        `select * from graphile_worker.job_queues`
      );
      expect(jobQueues).toHaveLength(1);
      const q = jobQueues[0];
      expect(q.queue_name).toEqual(job.queue_name);
      expect(q.job_count).toEqual(1);
      expect(+q.locked_at).toBeGreaterThanOrEqual(+start);
      expect(+q.locked_at).toBeLessThanOrEqual(+new Date());
      expect(q.locked_by).toEqual(worker.workerId);
    }

    jobPromise!.resolve();
    await runPromise;
    expect(executed).toBeTruthy();

    // Job should have been called once only
    expect(job1).toHaveBeenCalledTimes(1);
    expect(await jobCount(pgClient)).toEqual(0);
  }));

test("runs jobs in parallel", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule 5 jobs
    const start = new Date();
    await pgClient.query(
      `select graphile_worker.add_job('job1', '{"a": 1}') from generate_series(1, 5)`
    );

    // Run the task
    const jobPromises: Array<Deferred<void>> = [];
    const job1: Task = jest.fn(() => {
      const jobPromise = deferred();
      jobPromises.push(jobPromise);
      return jobPromise;
    });
    const tasks: TaskList = {
      job1
    };
    const runPromises = [
      runTaskListOnce(tasks, pgClient),
      runTaskListOnce(tasks, pgClient),
      runTaskListOnce(tasks, pgClient),
      runTaskListOnce(tasks, pgClient),
      runTaskListOnce(tasks, pgClient)
    ];
    let executed = false;
    Promise.all(runPromises).then(() => {
      executed = true;
    });

    await sleepUntil(() => jobPromises.length >= 5);

    // Job should have been called once for each task
    expect(jobPromises).toHaveLength(5);
    expect(job1).toHaveBeenCalledTimes(5);

    expect(executed).toBeFalsy();

    {
      const { rows: jobs } = await pgClient.query(
        `select * from graphile_worker.jobs`
      );
      expect(jobs).toHaveLength(5);
      jobs.forEach(job => {
        expect(job.task_identifier).toEqual("job1");
        expect(job.payload).toEqual({ a: 1 });
        expect(+job.run_at).toBeGreaterThanOrEqual(+start);
        expect(+job.run_at).toBeLessThanOrEqual(+new Date());
        expect(job.attempts).toEqual(1); // It gets increased when the job is checked out
      });

      const { rows: jobQueues } = await pgClient.query(
        `select * from graphile_worker.job_queues`
      );
      expect(jobQueues).toHaveLength(5);
      const locks: Array<string> = [];
      jobQueues.forEach(q => {
        const job = jobs.find(j => j.queue_name === q.queue_name);
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
    jobPromises.forEach(jobPromise => jobPromise!.resolve());
    await Promise.all(runPromises);
    expect(executed).toBeTruthy();

    // Job should not have been called any more times
    expect(job1).toHaveBeenCalledTimes(5);
    expect(await jobCount(pgClient)).toEqual(0);
  }));

test("single worker runs jobs in series, purges all before exit", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule 5 jobs
    await pgClient.query(
      `select graphile_worker.add_job('job1', '{"a": 1}') from generate_series(1, 5)`
    );

    // Run the task
    const jobPromises: Array<Deferred<void>> = [];
    const job1: Task = jest.fn(() => {
      const jobPromise = deferred();
      jobPromises.push(jobPromise);
      return jobPromise;
    });
    const tasks: TaskList = {
      job1
    };
    const runPromise = runTaskListOnce(tasks, pgClient);
    let executed = false;
    runPromise.then(() => {
      executed = true;
    });

    for (let i = 0; i < 5; i++) {
      await sleepUntil(() => jobPromises.length >= i + 1);
      expect(jobPromises).toHaveLength(i + 1);
      expect(job1).toHaveBeenCalledTimes(i + 1);

      // Shouldn't be finished yet
      expect(executed).toBeFalsy();

      // Complete this job, on to the next one
      jobPromises[i].resolve();
    }

    expect(jobPromises).toHaveLength(5);
    expect(job1).toHaveBeenCalledTimes(5);

    await runPromise;
    expect(executed).toBeTruthy();

    // Job should not have been called any more times
    expect(job1).toHaveBeenCalledTimes(5);
    expect(await jobCount(pgClient)).toEqual(0);
  }));

test("jobs added to the same queue will be ran serially (even if multiple workers)", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule 5 jobs
    await pgClient.query(
      `select graphile_worker.add_job('job1', '{"a": 1}', 'serial') from generate_series(1, 5)`
    );

    // Run the task
    const jobPromises: Array<Deferred<void>> = [];
    const job1: Task = jest.fn(() => {
      const jobPromise = deferred();
      jobPromises.push(jobPromise);
      return jobPromise;
    });
    const tasks: TaskList = {
      job1
    };
    const runPromises = [
      runTaskListOnce(tasks, pgClient),
      runTaskListOnce(tasks, pgClient),
      runTaskListOnce(tasks, pgClient)
    ];
    let executed = false;
    Promise.all(runPromises).then(() => {
      executed = true;
    });

    for (let i = 0; i < 5; i++) {
      // Give the other workers a chance to interfere (they shouldn't)
      sleep(50);

      await sleepUntil(() => jobPromises.length >= i + 1);
      expect(jobPromises).toHaveLength(i + 1);
      expect(job1).toHaveBeenCalledTimes(i + 1);

      // Shouldn't be finished yet
      expect(executed).toBeFalsy();

      // Complete this job, on to the next one
      jobPromises[i].resolve();
    }

    expect(jobPromises).toHaveLength(5);
    expect(job1).toHaveBeenCalledTimes(5);

    await Promise.all(runPromises);
    expect(executed).toBeTruthy();

    // Job should not have been called any more times
    expect(job1).toHaveBeenCalledTimes(5);
    expect(await jobCount(pgClient)).toEqual(0);
  }));
