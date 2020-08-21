import {
  makeWorkerUtils,
  runTaskListOnce,
  Task,
  WorkerSharedOptions,
} from "../src/index";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
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
    const { rows: jobs } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toHaveProperty("flags");
    expect(jobs[0].flags).toHaveLength(2);

    const task: Task = jest.fn();
    const taskList = { task };
    await runTaskListOnce(options, taskList, pgClient);
  }));

test("get_job skips forbidden flags with string[] arg", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const badFlag = "d";

    const shouldRun = jest.fn();
    const shouldSkip = jest.fn();

    const job: Task = async (_payload, helpers) => {
      const flags = helpers.job.flags || [];

      if (flags.includes(badFlag)) {
        shouldSkip();
      } else {
        shouldRun();
      }
    };

    // Schedule a job
    const utils = await makeWorkerUtils({ pgPool });

    await utils.addJob("flag-test", { a: 1 }, { flags: ["a", "b"] });
    await utils.addJob("flag-test", { a: 1 }, { flags: ["c", "d"] });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const pgClient = await pgPool.connect();
    try {
      await runTaskListOnce(
        { forbiddenFlags: [badFlag] },
        { "flag-test": job },
        pgClient,
      );

      const { rows: jobs } = await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toEqual(0);
      expect(jobs[0].flags).toEqual(["c", "d"]);

      expect(shouldRun).toHaveBeenCalledTimes(1);
      expect(shouldSkip).not.toHaveBeenCalled();
    } finally {
      pgClient.release();
    }
  }));

test("get_job skips forbidden flags with () => string[] arg", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const badFlag = "d";

    const shouldRun = jest.fn();
    const shouldSkip = jest.fn();

    const job: Task = async (_payload, helpers) => {
      const flags = helpers.job.flags || [];

      if (flags.includes(badFlag)) {
        shouldSkip();
      } else {
        shouldRun();
      }
    };

    // Schedule a job
    const utils = await makeWorkerUtils({ pgPool });

    await utils.addJob("flag-test", { a: 1 }, { flags: ["a", "b"] });
    await utils.addJob("flag-test", { a: 1 }, { flags: ["c", "d"] });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const pgClient = await pgPool.connect();
    try {
      await runTaskListOnce(
        { forbiddenFlags: () => [badFlag] },
        { "flag-test": job },
        pgClient,
      );

      const { rows: jobs } = await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0].attempts).toEqual(0);
      expect(jobs[0].flags).toEqual(["c", "d"]);

      expect(shouldRun).toHaveBeenCalledTimes(1);
      expect(shouldSkip).not.toHaveBeenCalled();
    } finally {
      pgClient.release();
    }
  }));

test("get_job skips forbidden flags with () => Promise<string[]> arg", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const badFlag = "d";

    const shouldRun = jest.fn();
    const shouldSkip = jest.fn();

    const job: Task = async (_payload, helpers) => {
      const flags = helpers.job.flags || [];

      if (flags.includes(badFlag)) {
        shouldSkip();
      } else {
        shouldRun();
      }
    };

    // Schedule a job
    const utils = await makeWorkerUtils({ pgPool });

    await utils.addJob("flag-test", { a: 1 }, { flags: ["a", "b"] });
    await utils.addJob("flag-test", { a: 1 }, { flags: ["c", "d"] });
    await utils.release();

    // Assert that it has an entry in jobs / job_queues
    const pgClient = await pgPool.connect();
    try {
      await runTaskListOnce(
        {
          forbiddenFlags: async () => {
            await sleep(5);
            return [badFlag];
          },
        },
        { "flag-test": job },
        pgClient,
      );

      expect(shouldRun).toHaveBeenCalledTimes(1);
      expect(shouldSkip).not.toHaveBeenCalled();
    } finally {
      pgClient.release();
    }
  }));
