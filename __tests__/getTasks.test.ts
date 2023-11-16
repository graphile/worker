import { WorkerSharedOptions } from "../src";
import { getTasks } from "../src/getTasks";
import { makeJobHelpers, makeWithPgClientFromClient } from "../src/helpers";
import { makeMockJob, withPgClient } from "./helpers";

const options: WorkerSharedOptions = {};

describe("commonjs", () => {
  test("gets tasks from folder", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = await getTasks(
        options,
        `${__dirname}/fixtures/tasks`,
      );
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "wouldyoulike",
  "wouldyoulike_default",
]
`);
      const helpers = makeJobHelpers(
        compiledSharedOptions,
        makeMockJob("would you like"),
        {
          withPgClient: makeWithPgClientFromClient(client),
          abortSignal: undefined,
        },
      );
      expect(await tasks.wouldyoulike!(helpers.job.payload, helpers)).toEqual(
        "some sausages",
      );
      expect(
        await tasks.wouldyoulike_default!(helpers.job.payload, helpers),
      ).toEqual("some more sausages");
      await release();
    }));

  test("get tasks from file (vanilla)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile.js`,
      );
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "task1",
  "task2",
]
`);

      const helpers = makeJobHelpers(
        compiledSharedOptions,
        makeMockJob("task1"),
        {
          withPgClient: makeWithPgClientFromClient(client),
          abortSignal: undefined,
        },
      );
      expect(await tasks.task1!(helpers.job.payload, helpers)).toEqual("hi");
      expect(await tasks.task2!(helpers.job.payload, helpers)).toEqual("hello");

      await release();
    }));

  test("get tasks from file (default)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile_default.js`,
      );
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "t1",
  "t2",
]
`);

      const helpers = makeJobHelpers(compiledSharedOptions, makeMockJob("t1"), {
        withPgClient: makeWithPgClientFromClient(client),
        abortSignal: undefined,
      });
      expect(await tasks.t1!(helpers.job.payload, helpers)).toEqual(
        "come with me",
      );
      expect(await tasks.t2!(helpers.job.payload, helpers)).toEqual(
        "if you want to live",
      );

      await release();
    }));
});

describe("esm", () => {
  test("gets tasks from folder", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasks`,
      );
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "wouldyoulike",
  "wouldyoulike_default",
]
`);
      const helpers = makeJobHelpers(
        compiledSharedOptions,
        makeMockJob("would you like"),
        {
          withPgClient: makeWithPgClientFromClient(client),
          abortSignal: undefined,
        },
      );
      expect(await tasks.wouldyoulike!(helpers.job.payload, helpers)).toEqual(
        "some sausages",
      );
      expect(
        await tasks.wouldyoulike_default!(helpers.job.payload, helpers),
      ).toEqual("some more sausages");
      await release();
    }));

  test("get tasks from file (vanilla)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasksFile.js`,
      );
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "task1",
  "task2",
]
`);

      const helpers = makeJobHelpers(
        compiledSharedOptions,
        makeMockJob("task1"),
        {
          withPgClient: makeWithPgClientFromClient(client),
          abortSignal: undefined,
        },
      );
      expect(await tasks.task1!(helpers.job.payload, helpers)).toEqual("hi");
      expect(await tasks.task2!(helpers.job.payload, helpers)).toEqual("hello");

      await release();
    }));

  test("get tasks from file (default)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasksFile_default.js`,
      );
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "t1",
  "t2",
]
`);

      const helpers = makeJobHelpers(compiledSharedOptions, makeMockJob("t1"), {
        withPgClient: makeWithPgClientFromClient(client),
        abortSignal: undefined,
      });
      expect(await tasks.t1!(helpers.job.payload, helpers)).toEqual(
        "come with me",
      );
      expect(await tasks.t2!(helpers.job.payload, helpers)).toEqual(
        "if you want to live",
      );

      await release();
    }));
});
