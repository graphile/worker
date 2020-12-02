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
  withPgClient(async (pgClient) => {
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
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job1", { a: 1 }, { jobKey: "UNIQUE" });
    await utils.addJob("job1", { a: 2 }, { jobKey: "UNIQUE" });
    await utils.addJob("job1", { a: 3 }, { jobKey: "UNIQUE" });
    await utils.addJob("job1", { a: 4 }, { jobKey: "UNIQUE" });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.a).toBe(4);
    expect(jobs[0].revision).toBe(3);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("supports the jobKey API with jobKeyMode", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    const runAt1 = new Date("2200-01-01T00:00:00Z");
    const runAt2 = new Date("2201-01-01T00:00:00Z");
    const runAt3 = new Date("2202-01-01T00:00:00Z");
    const runAt4 = new Date("2203-01-01T00:00:00Z");
    let job;
    job = await utils.addJob(
      "job1",
      { a: 1 },
      { jobKey: "UNIQUE", runAt: runAt1, jobKeyMode: "replace" },
    );
    expect(job.revision).toBe(0);
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());
    job = await utils.addJob(
      "job1",
      { a: 2 },
      { jobKey: "UNIQUE", runAt: runAt2, jobKeyMode: "preserve_run_at" },
    );
    expect(job.revision).toBe(1);
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());
    job = await utils.addJob(
      "job1",
      { a: 3 },
      { jobKey: "UNIQUE", runAt: runAt3, jobKeyMode: "preserve" },
    );
    expect(job.revision).toBe(2);
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());
    job = await utils.addJob(
      "job1",
      { a: 4 },
      { jobKey: "UNIQUE", runAt: runAt4, jobKeyMode: "replace" },
    );
    expect(job.revision).toBe(3);
    expect(job.run_at.toISOString()).toBe(runAt4.toISOString());
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const { rows: jobs } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.a).toBe(4);
    expect(jobs[0].revision).toBe(3);
    expect(jobs[0].run_at.toISOString()).toBe(runAt4.toISOString());

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("runs a job added through the addJob shortcut function", () =>
  withPgClient(async (pgClient) => {
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
