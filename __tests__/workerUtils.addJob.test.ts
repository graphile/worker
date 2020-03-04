import {
  makeWorkerUtils,
  quickAddJob,
  runTaskListOnce,
  Task,
  WorkerSharedOptions,
} from "../src/index";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  reset,
  TEST_CONNECTION_STRING,
  withPgClient,
} from "./helpers";

const options: WorkerSharedOptions = {};

test("runs a job added through the worker utils", () =>
  withPgClient(async pgClient => {
    await reset(pgClient, options);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job1", { a: 1 });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("supports the jobKey API", () =>
  withPgClient(async pgClient => {
    await reset(pgClient, options);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job1", { a: 1 }, { jobKey: "UNIQUE" });
    await utils.addJob("job1", { a: 2 }, { jobKey: "UNIQUE" });
    await utils.addJob("job1", { a: 3 }, { jobKey: "UNIQUE" });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("runs a job added through the addJob shortcut function", () =>
  withPgClient(async pgClient => {
    await reset(pgClient, options);

    // Schedule a job
    await quickAddJob({ connectionString: TEST_CONNECTION_STRING }, "job1", {
      a: 1,
    });

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));
