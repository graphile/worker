import {
  CompiledSharedOptions,
  WatchedTaskList,
  WorkerSharedOptions,
} from "../src";
import { getTasks } from "../src/getTasks";
import { makeJobHelpers, makeWithPgClientFromClient } from "../src/helpers";
import { makeEnhancedWithPgClient } from "../src/lib";
import { makeMockJob, withPgClient } from "./helpers";

const options: WorkerSharedOptions = {};

const neverAbortController = new AbortController();
const abortSignal = neverAbortController.signal;
const abortPromise = new Promise<void>((_, reject) => {
  abortSignal.addEventListener("abort", reject);
});

const __dirname = import.meta.dirname;

describe("commonjs", () => {
  test("gets tasks from folder", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasks`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "wouldyoulike",
  "wouldyoulike_default",
  "wouldyoulike_ts",
]
`);
      const helpers = makeJobHelpers(
        compiledSharedOptions,
        makeMockJob("would you like"),
        {
          withPgClient: makeEnhancedWithPgClient(
            makeWithPgClientFromClient(client),
          ),
          abortSignal,
          abortPromise,
        },
      );
      expect(await tasks.wouldyoulike!(helpers.job.payload, helpers)).toEqual(
        "some sausages",
      );
      expect(
        await tasks.wouldyoulike_default!(helpers.job.payload, helpers),
      ).toEqual("some more sausages");
      expect(
        await tasks.wouldyoulike_ts!(helpers.job.payload, helpers),
      ).toEqual("some TS sausages");
      await release();
    }));

  test("get tasks from file (vanilla)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile.js`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
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
          withPgClient: makeEnhancedWithPgClient(
            makeWithPgClientFromClient(client),
          ),
          abortSignal,
          abortPromise,
        },
      );
      expect(await tasks.task1!(helpers.job.payload, helpers)).toEqual("hi");
      expect(await tasks.task2!(helpers.job.payload, helpers)).toEqual("hello");

      await release();
    }));

  test("get tasks from file (vanilla-ts)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile-ts.js`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
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
          withPgClient: makeEnhancedWithPgClient(
            makeWithPgClientFromClient(client),
          ),
          abortSignal,
          abortPromise,
        },
      );
      expect(await tasks.task1!(helpers.job.payload, helpers)).toEqual("hi");
      expect(await tasks.task2!(helpers.job.payload, helpers)).toEqual(
        "hello from TS",
      );

      await release();
    }));

  test("get tasks from file (default)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile_default.js`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "t1",
  "t2",
]
`);

      const helpers = makeJobHelpers(compiledSharedOptions, makeMockJob("t1"), {
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
        abortSignal,
        abortPromise,
      });
      expect(await tasks.t1!(helpers.job.payload, helpers)).toEqual(
        "come with me",
      );
      expect(await tasks.t2!(helpers.job.payload, helpers)).toEqual(
        "if you want to live",
      );

      await release();
    }));

  test("get tasks from file (default-ts)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile_default-ts.js`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "t1",
  "t2",
]
`);

      const helpers = makeJobHelpers(compiledSharedOptions, makeMockJob("t1"), {
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
        abortSignal,
        abortPromise,
      });
      expect(await tasks.t1!(helpers.job.payload, helpers)).toEqual(
        "come with me, TS",
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
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasks`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
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
          withPgClient: makeEnhancedWithPgClient(
            makeWithPgClientFromClient(client),
          ),
          abortSignal,
          abortPromise,
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
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasksFile.mjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
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
          withPgClient: makeEnhancedWithPgClient(
            makeWithPgClientFromClient(client),
          ),
          abortSignal,
          abortPromise,
        },
      );
      expect(await tasks.task1!(helpers.job.payload, helpers)).toEqual("hi");
      expect(await tasks.task2!(helpers.job.payload, helpers)).toEqual("hello");

      await release();
    }));

  test("get tasks from file (default)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasksFile_default.mjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "t1",
  "t2",
]
`);

      const helpers = makeJobHelpers(compiledSharedOptions, makeMockJob("t1"), {
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
        abortSignal,
        abortPromise,
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
