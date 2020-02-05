import { withPgClient, reset, TEST_CONNECTION_STRING } from "./helpers";
import {
  makeWorkerUtils,
  quickAddJob,
  runTaskListOnce,
  Task,
} from "../src/index";

test("runs a job added through the worker utils", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job1", { a: 1 });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(taskList, pgClient);
  }));

test("runs a job added through the addJob shortcut function", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule a job
    await quickAddJob({ connectionString: TEST_CONNECTION_STRING }, "job1", {
      a: 1,
    });

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(taskList, pgClient);
  }));
