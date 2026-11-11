import { execFile } from "child_process";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { promisify } from "util";

import { getTasks } from "../src/getTasks.ts";
import {
  makeJobHelpers,
  makeWithPgClientFromClient,
  makeWorkerShared,
} from "../src/helpers.ts";
import type {
  CompiledSharedOptions,
  WatchedTaskList,
  WorkerSharedOptions,
} from "../src/index.ts";
import { makeEnhancedWithPgClient } from "../src/lib.ts";
import { makeMockJob, withPgClient } from "./helpers.ts";

const __dirname = import.meta.dirname;

const options: WorkerSharedOptions = {};

const neverAbortController = new AbortController();
const abortSignal = neverAbortController.signal;
const abortPromise = new Promise<void>((_, reject) => {
  abortSignal.addEventListener("abort", reject);
});

describe.each(["cjs", "mjs"])("task file paths (%s)", (extension) => {
  test.each([
    "tasks#hash",
    "tasks%percent",
    "tasks%20encoded",
    "parent#%directory/tasks",
  ])("loads the requested file: %s", async (name) => {
    const directory = await mkdtemp(join(tmpdir(), "graphile-worker-tasks-"));
    const filename = join(directory, `${name}.${extension}`);
    try {
      await mkdir(dirname(filename), { recursive: true });
      await writeFile(
        filename,
        extension === "cjs"
          ? "module.exports = { requestedTask() {} };"
          : "export function requestedTask() {}",
      );
      // A literal percent escape must not select a different, existing file.
      if (name.includes("%20")) {
        await writeFile(
          filename.replace("%20", " "),
          extension === "cjs"
            ? "module.exports = { otherTask() {} };"
            : "export function otherTask() {}",
        );
      }
      // Jest's module resolver accepts paths that Node's native import rejects.
      const { stdout } = await promisify(execFile)(process.execPath, [
        "--input-type=module",
        "--eval",
        `
          const { getTasks } = await import(process.argv[1]);
          const { tasks, release } = await getTasks({}, process.argv[2]);
          try {
            console.log(JSON.stringify(Object.keys(tasks)));
          } finally {
            await release();
          }
        `,
        new URL("../dist/index.js", import.meta.url).href,
        filename,
      ]);
      expect(JSON.parse(stdout)).toEqual(["requestedTask"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("commonjs", () => {
  test("gets tasks from folder", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasks`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "wouldyoulike",
          "wouldyoulike_default",
          "wouldyoulike_ts",
        ]
      `);
      const helpers = makeJobHelpers(
        workerShared,
        makeMockJob("would you like"),
        { abortSignal, abortPromise },
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
        `${__dirname}/fixtures/tasksFile.cjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "task1",
          "task2",
        ]
      `);

      const helpers = makeJobHelpers(workerShared, makeMockJob("task1"), {
        abortSignal,
        abortPromise,
      });
      expect(await tasks.task1!(helpers.job.payload, helpers)).toEqual("hi");
      expect(await tasks.task2!(helpers.job.payload, helpers)).toEqual("hello");

      await release();
    }));

  test("get tasks from file (vanilla-ts)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures/tasksFile-ts.cjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "task1",
          "task2",
        ]
      `);

      const helpers = makeJobHelpers(workerShared, makeMockJob("task1"), {
        abortSignal,
        abortPromise,
      });
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
        `${__dirname}/fixtures/tasksFile_default.cjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "t1",
          "t2",
        ]
      `);

      const helpers = makeJobHelpers(workerShared, makeMockJob("t1"), {
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
        `${__dirname}/fixtures/tasksFile_default-ts.cjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "t1",
          "t2",
        ]
      `);

      const helpers = makeJobHelpers(workerShared, makeMockJob("t1"), {
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
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "module-typescript",
          "typescript",
          "wouldyoulike",
          "wouldyoulike_default",
        ]
      `);
      const helpers = makeJobHelpers(
        workerShared,
        makeMockJob("would you like"),
        { abortSignal, abortPromise },
      );
      expect(await tasks.wouldyoulike!(helpers.job.payload, helpers)).toEqual(
        "some sausages",
      );
      expect(
        await tasks.wouldyoulike_default!(helpers.job.payload, helpers),
      ).toEqual("some more sausages");
      expect(await tasks.typescript!(helpers.job.payload, helpers)).toEqual(
        "some typescript",
      );
      expect(
        await tasks["module-typescript"]!(helpers.job.payload, helpers),
      ).toEqual("some module typescript");
      await release();
    }));

  test("get tasks from file (vanilla)", () =>
    withPgClient(async (client) => {
      const { tasks, release, compiledSharedOptions } = (await getTasks(
        options,
        `${__dirname}/fixtures-esm/tasksFile.mjs`,
      )) as WatchedTaskList & { compiledSharedOptions: CompiledSharedOptions };
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "task1",
          "task2",
        ]
      `);

      const helpers = makeJobHelpers(workerShared, makeMockJob("task1"), {
        abortSignal,
        abortPromise,
      });
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
      const workerShared = makeWorkerShared({
        compiledSharedOptions,
        withPgClient: makeEnhancedWithPgClient(
          makeWithPgClientFromClient(client),
        ),
      });
      expect(tasks).toBeTruthy();
      expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
        [
          "t1",
          "t2",
        ]
      `);

      const helpers = makeJobHelpers(workerShared, makeMockJob("t1"), {
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
