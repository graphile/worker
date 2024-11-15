import type { Job } from "../src/index";
import {
  addJobAdhoc,
  makeWorkerUtils,
  runTaskListOnce,
  Task,
  WorkerSharedOptions,
  WorkerUtils,
} from "../src/index";
import { getJobs, HOUR, reset, setupFakeTimers, withPgClient } from "./helpers";

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
    await utils.addJobs([{ identifier: "job3", payload: { a: 1 } }]);
    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);

    const task: Task = jest.fn();
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
    await utils.addJobs([
      { identifier: "job3", payload: { a: 1 }, jobKey: "UNIQUE" },
    ]);
    await utils.addJobs([
      { identifier: "job3", payload: { a: 2 }, jobKey: "UNIQUE" },
    ]);
    await utils.addJobs([
      { identifier: "job3", payload: { a: 3 }, jobKey: "UNIQUE" },
    ]);
    await utils.addJobs([
      { identifier: "job3", payload: { a: 4 }, jobKey: "UNIQUE" },
    ]);
    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect((jobs[0].payload as any).a).toBe(4);
    expect(jobs[0].revision).toBe(3);

    const task: Task = jest.fn();
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
    let job: Job;

    // Job first added in replace mode:
    [job] = await utils.addJobs([
      {
        identifier: "job3",
        payload: { a: 1 },
        jobKey: "UNIQUE",
        runAt: runAt1,
      },
    ]);
    expect(job.revision).toBe(0);
    expect(job.payload).toEqual({ a: 1 });
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());

    // Now updated, but preserve run_at
    [job] = await utils.addJobs(
      [
        {
          identifier: "job3",
          payload: { a: 2 },
          jobKey: "UNIQUE",
          runAt: runAt2,
        },
      ],
      true,
    );
    expect(job.revision).toBe(1);
    expect(job.payload).toEqual({ a: 2 });
    expect(job.run_at.toISOString()).toBe(runAt1.toISOString());

    // Replace the job one final time
    [job] = await utils.addJobs([
      {
        identifier: "job3",
        payload: { a: 4 },
        jobKey: "UNIQUE",
        runAt: runAt4,
      },
    ]);
    expect(job.revision).toBe(2);
    expect(job.payload).toEqual({ a: 4 });
    expect(job.run_at.toISOString()).toBe(runAt4.toISOString());

    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].revision).toBe(2);
    expect((jobs[0].payload as any).a).toBe(4);
    expect(jobs[0].run_at.toISOString()).toBe(runAt4.toISOString());

    const task: Task = jest.fn();
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

    const task: Task = jest.fn();
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
    await utils.addJobs([{ identifier: "job3", payload: { a: 1 } }]);
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

test("adding lots of jobs works", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    // Schedule a job
    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    const timeOfAddJob = REFERENCE_TIMESTAMP + 1 * HOUR;
    await setTime(timeOfAddJob);
    await utils.addJobs([
      { identifier: "job3", payload: { a: 1 } },
      { identifier: "job3", payload: { a: 2 } },
      { identifier: "job3", payload: { a: 3 } },
      { identifier: "job3", payload: { a: 4 } },
      { identifier: "job3", payload: { a: 5 } },
      { identifier: "job3", payload: { a: 6 } },
    ]);
    await utils.release();
    utils = null;

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(6);
    const a = jobs.map((j) => j.payload.a).sort();
    expect(a).toEqual([1, 2, 3, 4, 5, 6]);
  }));
