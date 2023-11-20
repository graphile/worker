import { Pool } from "pg";

import { makeWorkerPresetWorkerOptions } from "../src/config";
import { RunnerOptions } from "../src/interfaces";
import { WorkerPreset } from "../src/preset";
import { runOnce } from "../src/runner";
import {
  PGDATABASE,
  PGHOST,
  TEST_CONNECTION_STRING,
  withPgPool,
} from "./helpers";

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
  } catch (e) {
    expect(e.message).toMatch(message);
  }
}

test("either a list of tasks or a existent task directory must be provided", async () => {
  const options: RunnerOptions = {
    connectionString: TEST_CONNECTION_STRING,
  };
  await runOnceErrorAssertion(
    options,
    /^Could not find tasks to execute - taskDirectory '[^']+\/tasks' does not exist$/,
  );
});

test("taskList and taskDirectory cannot be provided a the same time", async () => {
  const options: RunnerOptions = {
    connectionString: TEST_CONNECTION_STRING,
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
  const options: RunnerOptions = {
    taskList: { task: () => {} },
    connectionString: TEST_CONNECTION_STRING,
    pgPool: new Pool(),
  };
  await runOnceErrorAssertion(
    options,
    "Both `pgPool` and `connectionString` are set, at most one of these options should be provided",
  );
});

test("providing just a DATABASE_URL is possible", async () => {
  return withEnv({ DATABASE_URL: TEST_CONNECTION_STRING }, async () => {
    const options: RunnerOptions = {
      taskList: { task: () => {} },
    };
    expect.assertions(0);
    await runOnce(options);
  });
});

test("providing just PGHOST and PGDATABASE is possible", async () => {
  return withEnv({ PGHOST, PGDATABASE }, async () => {
    const options: RunnerOptions = {
      taskList: { task: () => {} },
    };
    expect.assertions(0);
    await runOnce(options);
  });
});

test("providing just a connectionString is possible", async () => {
  const options: RunnerOptions = {
    taskList: { task: () => {} },
    connectionString: TEST_CONNECTION_STRING,
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
