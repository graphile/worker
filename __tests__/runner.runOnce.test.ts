import { runOnce } from "../src/runner";
import { RunnerOptions } from "../src/interfaces";
import { Pool } from "pg";
import { withPgPool, TEST_CONNECTION_STRING } from "./helpers";

async function runOnceErrorAssertion(options: RunnerOptions, message: string) {
  expect.assertions(1);
  try {
    await runOnce(options);
  } catch (e) {
    expect(e.message).toMatch(message);
  }
}

test("at least a list of tasks or a task directory must be provided", async () => {
  const options: RunnerOptions = {
    connectionString: TEST_CONNECTION_STRING,
  };
  await runOnceErrorAssertion(
    options,
    "You must specify either `options.taskList` or `options.taskDirectory"
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
    "Exactly one of either `taskDirectory` or `taskList` should be set"
  );
});

test("at least a connectionString, a pgPool or the DATABASE_URL env variable must be provided", async () => {
  const options: RunnerOptions = {
    taskList: { task: () => {} },
  };
  await runOnceErrorAssertion(
    options,
    "You must either specify `pgPool` or `connectionString`, or you must make the `DATABASE_URL` environmental variable available."
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
    "Both `pgPool` and `connectionString` are set, at most one of these options should be provided"
  );
});

test("providing just a DATABASE_URL is possible", async () => {
  process.env.DATABASE_URL = TEST_CONNECTION_STRING;
  const options: RunnerOptions = {
    taskList: { task: () => {} },
  };
  expect.assertions(0);
  await runOnce(options);
  delete process.env.DATABASE_URL;
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
  withPgPool(async pgPool => {
    const options: RunnerOptions = {
      taskList: { task: () => {} },
      pgPool: pgPool,
    };
    expect.assertions(0);
    await runOnce(options);
  }));
