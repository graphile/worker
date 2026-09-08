import { jest } from "@jest/globals";

import { makeWithPgClientFromClient } from "../src/helpers.ts";
import type { Task, WorkerSharedOptions, WorkerUtils } from "../src/index.ts";
import { addJobAdhoc, makeWorkerUtils, runTaskListOnce } from "../src/index.ts";
import { makeEnhancedWithPgClient, processSharedOptions } from "../src/lib.ts";
import { getTaskDetails } from "../src/taskIdentifiers.ts";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  getJobs,
  GRAPHILE_WORKER_SCHEMA,
  HOUR,
  reset,
  setupFakeTimers,
  withPgClient,
} from "./helpers.ts";

const { setTime } = setupFakeTimers();
const REFERENCE_TIMESTAMP = 1609459200000; /* 1st January 2021, 00:00:00 UTC */

const options: WorkerSharedOptions = {};

let utils: WorkerUtils | null = null;
afterEach(async () => {
  await utils?.release();
  utils = null;
});

test("runs a job added through the worker utils", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    // Schedule a job
    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job3", { a: 1 });
    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn(() => {});
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("supports the jobKey API", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    // Schedule a job
    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job3", { a: 1 }, { jobKey: "UNIQUE" });
    await utils.addJob("job3", { a: 2 }, { jobKey: "UNIQUE" });
    await utils.addJob("job3", { a: 3 }, { jobKey: "UNIQUE" });
    await utils.addJob("job3", { a: 4 }, { jobKey: "UNIQUE" });
    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as any).a).toBe(4);
    expect(jobs[0].revision).toBe(3);

    const task: Task = jest.fn(() => {});
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("supports the jobKey API with jobKeyMode", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    // Schedule a job
    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    const runAt1 = new Date("2200-01-01T00:00:00Z");
    const runAt2 = new Date("2201-01-01T00:00:00Z");
    const runAt3 = new Date("2202-01-01T00:00:00Z");
    const runAt4 = new Date("2203-01-01T00:00:00Z");
    let job;

    // Job first added in replace mode:
    job = await utils.addJob(
      "job3",
      { a: 1 },
      { jobKey: "UNIQUE", runAt: runAt1, jobKeyMode: "replace" },
    );
    expect(job.revision).toBe(0);
    expect(job.payload).toEqual({ a: 1 });
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());

    // Now updated, but preserve run_at
    job = await utils.addJob(
      "job3",
      { a: 2 },
      { jobKey: "UNIQUE", runAt: runAt2, jobKeyMode: "preserve_run_at" },
    );
    expect(job.revision).toBe(1);
    expect(job.payload).toEqual({ a: 2 });
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());

    // unsafe_dedupe should take no action other than to bump the revision number
    job = await utils.addJob(
      "job3",
      { a: 3 },
      { jobKey: "UNIQUE", runAt: runAt3, jobKeyMode: "unsafe_dedupe" },
    );
    expect(job.revision).toBe(2);
    expect(job.payload).toEqual({ a: 2 });
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());

    // Replace the job one final time
    job = await utils.addJob(
      "job3",
      { a: 4 },
      { jobKey: "UNIQUE", runAt: runAt4, jobKeyMode: "replace" },
    );
    expect(job.revision).toBe(3);
    expect(job.payload).toEqual({ a: 4 });
    expect(job.run_at.toISOString()).toBe(runAt4.toISOString());

    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].revision).toBe(3);
    expect((jobs[0].payload as any).a).toBe(4);
    expect(jobs[0].run_at.toISOString()).toBe(runAt4.toISOString());

    const task: Task = jest.fn(() => {});
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("runs a job added through the addJob shortcut function", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    // Schedule a job
    await addJobAdhoc({ connectionString: TEST_CONNECTION_STRING }, "job3", {
      a: 1,
    });

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn(() => {});
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("adding job respects useNodeTime", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await setTime(REFERENCE_TIMESTAMP);
    await reset(pgClient, options);

    // Schedule a job
    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
      useNodeTime: true,
    });
    const timeOfAddJob = REFERENCE_TIMESTAMP + 1 * HOUR;
    await setTime(timeOfAddJob);
    await utils.addJob("job3", { a: 1 });
    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    // Assert the run_at is within a couple of seconds of timeOfAddJob, even
    // though PostgreSQL has a NOW() that's many months later.
    const runAt = jobs[0].run_at;
    expect(+runAt).toBeGreaterThan(timeOfAddJob - 2000);
    expect(+runAt).toBeLessThan(timeOfAddJob + 2000);
  }));

test("does not consume task identity when identifier already exists (GH-619)", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    // Register the identifier and a named queue once (add_jobs path)
    await utils.addJob("my_task", { a: 1 }, { queueName: "q1" });

    const {
      rows: [{ task_count: initialTaskCount, queue_count: initialQueueCount }],
    } = await pgClient.query(
      `select
        (select count(*)::int from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks) as task_count,
        (select count(*)::int from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues) as queue_count`,
    );
    expect(initialTaskCount).toBe(1);
    expect(initialQueueCount).toBe(1);

    const {
      rows: [{ tasksPrev }],
    } = await pgClient.query(
      `select currval(pg_get_serial_sequence('${GRAPHILE_WORKER_SCHEMA}._private_tasks', 'id')) as "tasksPrev"`,
    );
    const {
      rows: [{ jobsPrev }],
    } = await pgClient.query(
      `select currval(pg_get_serial_sequence('${GRAPHILE_WORKER_SCHEMA}._private_job_queues', 'id')) as "jobsPrev"`,
    );

    // Same identifier + queue must not call nextval (would raise at integer ceiling)
    await expect(
      utils.addJob("my_task", { a: 2 }, { queueName: "q1" }),
    ).resolves.toBeTruthy();

    // unsafe_dedupe path also must not consume identity
    await expect(
      utils.addJob(
        "my_task",
        { a: 3 },
        { queueName: "q1", jobKey: "gh619", jobKeyMode: "unsafe_dedupe" },
      ),
    ).resolves.toBeTruthy();

    const {
      rows: [{ task_count, queue_count }],
    } = await pgClient.query(
      `select
        (select count(*)::int from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks) as task_count,
        (select count(*)::int from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues) as queue_count`,
    );
    expect(task_count).toBe(1);
    expect(queue_count).toBe(1);

    // Startup getTaskDetails insert must also skip existing identifiers
    const compiledSharedOptions = processSharedOptions({
      connectionString: TEST_CONNECTION_STRING,
    });
    const details = await getTaskDetails(
      compiledSharedOptions,
      makeEnhancedWithPgClient(makeWithPgClientFromClient(pgClient)),
      { my_task() {} },
    );
    expect(details.taskIds).toHaveLength(1);

    const {
      rows: [{ task_count: taskCountAfterDetails }],
    } = await pgClient.query(
      `select count(*)::int as task_count from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks`,
    );
    expect(taskCountAfterDetails).toBe(1);

    const {
      rows: [{ tasksNow }],
    } = await pgClient.query(
      `select currval(pg_get_serial_sequence('${GRAPHILE_WORKER_SCHEMA}._private_tasks', 'id')) as "tasksNow"`,
    );
    const {
      rows: [{ jobsNow }],
    } = await pgClient.query(
      `select currval(pg_get_serial_sequence('${GRAPHILE_WORKER_SCHEMA}._private_job_queues', 'id')) as "jobsNow"`,
    );

    expect(tasksNow).toEqual(tasksPrev);
    expect(jobsNow).toEqual(jobsPrev);

    await utils.release();
    utils = null;
  }));
