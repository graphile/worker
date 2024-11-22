import { Pool } from "pg";

import { makeWorkerPresetWorkerOptions } from "../src/config";
import { Job, RunnerOptions, WorkerUtils } from "../src/interfaces";
import { coerceError } from "../src/lib";
import { _allWorkerPools } from "../src/main";
import { WorkerPreset } from "../src/preset";
import { runOnce } from "../src/runner";
import { makeWorkerUtils } from "../src/workerUtils";
import {
  databaseDetails,
  getJobs,
  makeSelectionOfJobs,
  reset,
  sleep,
  sleepUntil,
  withPgPool,
} from "./helpers";

delete process.env.DATABASE_URL;
delete process.env.PGDATABASE;

function setEnvvars(env: { [key: string]: string | undefined }) {
  Object.entries(env).forEach(([key, val]) => {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  });
}

async function withEnv<T>(
  envOverrides: { [key: string]: string | undefined },
  callback: () => Promise<T>,
): Promise<T> {
  const old = Object.keys(envOverrides).reduce((memo, key) => {
    memo[key] = process.env[key];
    return memo;
  }, {} as { [key: string]: string | undefined });
  setEnvvars(envOverrides);
  const prev = WorkerPreset.worker;
  WorkerPreset.worker = makeWorkerPresetWorkerOptions();
  try {
    return await callback();
  } finally {
    setEnvvars(old);
    WorkerPreset.worker = prev;
  }
}

async function runOnceErrorAssertion(
  options: RunnerOptions,
  message: RegExp | string,
) {
  expect.assertions(1);
  try {
    await runOnce(options);
  } catch (rawE) {
    const e = coerceError(rawE);
    expect(e.message).toMatch(message);
  }
}

test("either a list of tasks or a existent task directory must be provided", async () => {
  const options: RunnerOptions = {
    connectionString: databaseDetails!.TEST_CONNECTION_STRING,
  };
  await runOnceErrorAssertion(
    options,
    /^Could not find tasks to execute - taskDirectory '[^']+\/tasks' does not exist$/,
  );
});

test("taskList and taskDirectory cannot be provided a the same time", async () => {
  const options: RunnerOptions = {
    connectionString: databaseDetails!.TEST_CONNECTION_STRING,
    taskDirectory: "foo",
    taskList: { task: () => {} },
  };
  await runOnceErrorAssertion(
    options,
    "Exactly one of either `taskDirectory` or `taskList` should be set",
  );
});

test("at least a connectionString, a pgPool, the DATABASE_URL or PGDATABASE envvars must be provided", async () => {
  const options: RunnerOptions = {
    taskList: { task: () => {} },
  };
  await runOnceErrorAssertion(
    options,
    "You must either specify `pgPool` or `connectionString`, or you must make the `DATABASE_URL` or `PG*` environmental variables available.",
  );
});

test("connectionString and a pgPool cannot provided a the same time", async () => {
  const pgPool = new Pool();
  pgPool.on("error", () => {});
  pgPool.on("connect", () => {});
  const options: RunnerOptions = {
    taskList: { task: () => {} },
    connectionString: databaseDetails!.TEST_CONNECTION_STRING,
    pgPool,
  };
  await runOnceErrorAssertion(
    options,
    "Both `pgPool` and `connectionString` are set, at most one of these options should be provided",
  );
});

test("providing just a DATABASE_URL is possible", async () => {
  return withEnv(
    { DATABASE_URL: databaseDetails!.TEST_CONNECTION_STRING },
    async () => {
      const options: RunnerOptions = {
        taskList: { task: () => {} },
      };
      expect.assertions(0);
      await runOnce(options);
    },
  );
});

test("providing just PGHOST and PGDATABASE is possible", async () => {
  return withEnv(
    {
      PGHOST: databaseDetails!.PGHOST,
      PGDATABASE: databaseDetails!.PGDATABASE,
    },
    async () => {
      const options: RunnerOptions = {
        taskList: { task: () => {} },
      };
      expect.assertions(0);
      await runOnce(options);
    },
  );
});

test("providing just a connectionString is possible", async () => {
  const options: RunnerOptions = {
    taskList: { task: () => {} },
    connectionString: databaseDetails!.TEST_CONNECTION_STRING,
  };
  expect.assertions(0);
  await runOnce(options);
});

test("providing just a pgPool is possible", async () =>
  withPgPool(async (pgPool) => {
    const options: RunnerOptions = {
      taskList: { task: () => {} },
      pgPool: pgPool,
    };
    expect.assertions(0);
    await runOnce(options);
  }));

let utils: WorkerUtils | null = null;
afterEach(async () => {
  await utils?.release();
  utils = null;
});

test("runs all available tasks and then exits", async () =>
  withPgPool(async (pgPool) => {
    const options: RunnerOptions = {
      taskList: { job1: () => {}, job2: () => {}, job3: () => {} },
      pgPool: pgPool,
      useNodeTime: true,
    };
    utils = await makeWorkerUtils(options);
    await utils.addJob("job1", { id: "PRE_SELECTION_1" });
    await utils.addJob("job2", { id: "PRE_SELECTION_2" });
    await utils.addJob("job3", { id: "PRE_SELECTION_3" });
    const unavailableJobs = Object.values(
      await makeSelectionOfJobs(utils, pgPool),
    );
    await utils.addJob("job1", { id: "POST_SELECTION_1" });
    await utils.addJob("job2", { id: "POST_SELECTION_2" });
    await utils.addJob("job3", { id: "POST_SELECTION_3" });
    {
      const jobs = await getJobs(pgPool);
      expect(jobs).toHaveLength(unavailableJobs.length + 6);
    }
    await runOnce(options);
    {
      const unavailableJobIds = unavailableJobs.map((j) => j.id);
      let jobs!: Job[];
      for (let attempts = 0; attempts < 10; attempts++) {
        jobs = await getJobs(pgPool);
        if (jobs.length === unavailableJobs.length) {
          break;
        } else {
          await sleep(attempts * 50);
        }
      }
      expect(jobs).toHaveLength(unavailableJobs.length);
      expect(
        jobs.filter((j) => !unavailableJobIds.includes(j.id)),
      ).toHaveLength(0);
    }
  }));

test("gracefulShutdown", async () =>
  withPgPool(async (pgPool) => {
    let jobStarted = false;
    const options: RunnerOptions = {
      taskList: {
        job1(payload, helpers) {
          jobStarted = true;
          return Promise.race([sleep(100000, true), helpers.abortPromise]);
        },
      },
      pgPool,
      preset: {
        worker: {
          gracefulShutdownAbortTimeout: 20,
          useNodeTime: true,
        },
      },
    };
    await reset(pgPool, options);
    utils = await makeWorkerUtils(options);
    await utils.addJob("job1", { id: "test sleep" });
    expect(_allWorkerPools).toHaveLength(0);
    const promise = runOnce(options);
    await sleepUntil(() => _allWorkerPools.length === 1);
    expect(_allWorkerPools).toHaveLength(1);
    const pool = _allWorkerPools[0];
    await sleepUntil(() => jobStarted);
    await pool.gracefulShutdown();
    await promise;
    let jobs: Job[] = [];
    for (let attempts = 0; attempts < 10; attempts++) {
      jobs = await getJobs(pgPool);
      if (jobs[0]?.last_error) {
        break;
      } else {
        await sleep(25 * attempts);
      }
    }
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    expect(job.last_error).toBeTruthy();
  }));
