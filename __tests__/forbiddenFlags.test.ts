import {
  makeWorkerUtils,
  runTaskListOnce,
  Task,
  WorkerSharedOptions,
} from "../src/index";
import {
  getJobs,
  reset,
  TEST_CONNECTION_STRING,
  withPgClient,
  withPgPool,
} from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const options: WorkerSharedOptions = {};

test("supports the flags API", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    await utils.addJob("job1", { a: 1 }, { flags: ["a", "b"] });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toHaveProperty("flags");
    expect(jobs[0].flags).toEqual({ a: true, b: true });

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

const badFlag = "d";

test.each([
  ["string[]", [badFlag]],
  ["()=>string[]", () => [badFlag]],
  [
    "()=>Promise<string[]>",
    async () => {
      await sleep(5);
      return [badFlag];
    },
  ],
])("get_job skips forbidden flags with %s arg", (_, forbiddenFlags) =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const shouldRun = jest.fn();
    const shouldSkip = jest.fn();

    const job: Task = async (_payload, helpers) => {
      const flags = helpers.job.flags || {};

      if (flags[badFlag]) {
        shouldSkip();
      } else {
        shouldRun();
      }
    };

    // Schedule a job
    const utils = await makeWorkerUtils({ pgPool });

    await utils.addJob("flag-test", { a: 1 }, { flags: ["a", "b"] });
    await utils.addJob("flag-test", { a: 1 }, { flags: ["c", badFlag] });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const pgClient = await pgPool.connect();
    try {
      await runTaskListOnce({ forbiddenFlags }, { "flag-test": job }, pgClient);

      const jobs = await getJobs(pgClient);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toEqual(0);
      expect(jobs[0].flags).toEqual({ c: true, d: true });

      expect(shouldRun).toHaveBeenCalledTimes(1);
      expect(shouldSkip).not.toHaveBeenCalled();
    } finally {
      pgClient.release();
    }
  }),
);

test.each([
  ["unknown flag", ["z"]],
  ["empty[]", []],
  ["()=>empty[]", () => []],
  [
    "()=>Promise<empty[]>",
    async () => {
      await sleep(5);
      return [];
    },
  ],
  ["null", null],
  ["()=>null", () => null],
  [
    "()=>Promise<null>",
    async () => {
      await sleep(5);
      return null;
    },
  ],
])("get_job runs all jobs with forbidden flags = %s", (_, forbiddenFlags) =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const ranWithoutDFlag = jest.fn();
    const ranWithDFlag = jest.fn();

    const job: Task = async (_payload, helpers) => {
      const flags = helpers.job.flags || {};

      if (flags[badFlag]) {
        ranWithDFlag();
      } else {
        ranWithoutDFlag();
      }
    };

    // Schedule a job
    const utils = await makeWorkerUtils({ pgPool });

    await utils.addJob("flag-test", { a: 1 }, { flags: ["a", "b"] });
    await utils.addJob("flag-test", { a: 1 }, { flags: ["c", badFlag] });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const pgClient = await pgPool.connect();
    try {
      await runTaskListOnce({ forbiddenFlags }, { "flag-test": job }, pgClient);

      const jobs = await getJobs(pgClient);
      expect(jobs).toHaveLength(0);

      expect(ranWithoutDFlag).toHaveBeenCalledTimes(1);
      expect(ranWithDFlag).toHaveBeenCalledTimes(1);
    } finally {
      pgClient.release();
    }
  }),
);
