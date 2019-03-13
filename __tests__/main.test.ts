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
    expect(+job.run_at).toBeGreaterThan(+start);
    expect(+job.run_at).toBeLessThan(+new Date() + 2719);
  }));
