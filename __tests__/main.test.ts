import { migrate } from "../src/migrate";
import { withPgClient } from "./helpers";
import { TaskList, Task } from "../src/interfaces";
import { runAllJobs } from "../src/main";
import { PoolClient } from "pg";

async function reset(pgClient: PoolClient) {
  await pgClient.query("drop schema if exists graphile_worker cascade;");
  await migrate(pgClient);
}

test("runs jobs", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);
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
    await runAllJobs(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);
    expect(job2).not.toHaveBeenCalled();
  }));

test("schedules errors for retry", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);
    const start = new Date();
    const job1: Task = jest.fn(() => {
      throw new Error("TEST_ERROR");
    });
    const tasks: TaskList = {
      job1
    };
    await runAllJobs(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);
    const { rows: jobs } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.task_identifier).toEqual("job1");
    expect(job.attempts).toEqual(1);
    expect(job.last_error).toEqual("TEST_ERROR");
    // It's the first attempt, so delay is exp(1) ~= 2.719 seconds
    expect(+job.run_at).toBeGreaterThan(+start + 2718);
    expect(+job.run_at).toBeLessThan(+new Date() + 2719);
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
    await runAllJobs(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);

    // Should do nothing the second time, because it's queued for the future (assuming we run this fast enough afterwards!)
    await runAllJobs(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);

    // Tell the job to be runnable
    await pgClient.query(
      `update graphile_worker.jobs set run_at = now() where task_identifier = 'job1'`
    );

    // Run the job
    const start = new Date();
    await runAllJobs(tasks, pgClient);

    // It should have ran again
    expect(job1).toHaveBeenCalledTimes(2);

    // And it should have been rejected again
    const { rows: jobs } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.task_identifier).toEqual("job1");
    expect(job.attempts).toEqual(2);
    expect(job.last_error).toEqual("TEST_ERROR 2");
    // It's the second attempt, so delay is exp(2) ~= 7.389 seconds
    expect(+job.run_at).toBeGreaterThan(+start + 7388);
    expect(+job.run_at).toBeLessThan(+new Date() + 7389);
  }));
