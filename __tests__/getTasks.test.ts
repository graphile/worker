import getTasks from "../src/getTasks";
import { makeMockJob, withPgClient } from "./helpers";
import { makeJobHelpers, makeWithPgClientFromClient } from "../src/helpers";
import { WorkerSharedOptions } from "../src";

const options: WorkerSharedOptions = {};

test("gets tasks from folder", () =>
  withPgClient(async client => {
    const { tasks, release } = await getTasks(`${__dirname}/fixtures/tasks`);
    expect(tasks).toBeTruthy();
    expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "wouldyoulike",
  "wouldyoulike_default",
]
`);
    const helpers = makeJobHelpers(
      makeMockJob("would you like"),
      {
        withPgClient: makeWithPgClientFromClient(client),
      },
      options
    );
    expect(await tasks.wouldyoulike(helpers.job.payload, helpers)).toEqual(
      "some sausages"
    );
    expect(
      await tasks.wouldyoulike_default(helpers.job.payload, helpers)
    ).toEqual("some more sausages");
    await release();
  }));

test("get tasks from file (vanilla)", () =>
  withPgClient(async client => {
    const { tasks, release } = await getTasks(
      `${__dirname}/fixtures/tasksFile.js`
    );
    expect(tasks).toBeTruthy();
    expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "task1",
  "task2",
]
`);

    const helpers = makeJobHelpers(
      makeMockJob("task1"),
      {
        withPgClient: makeWithPgClientFromClient(client),
      },
      options
    );
    expect(await tasks.task1(helpers.job.payload, helpers)).toEqual("hi");
    expect(await tasks.task2(helpers.job.payload, helpers)).toEqual("hello");

    await release();
  }));

test("get tasks from file (default)", () =>
  withPgClient(async client => {
    const { tasks, release } = await getTasks(
      `${__dirname}/fixtures/tasksFile_default.js`
    );
    expect(tasks).toBeTruthy();
    expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "t1",
  "t2",
]
`);

    const helpers = makeJobHelpers(
      makeMockJob("t1"),
      {
        withPgClient: makeWithPgClientFromClient(client),
      },
      options
    );
    expect(await tasks.t1(helpers.job.payload, helpers)).toEqual(
      "come with me"
    );
    expect(await tasks.t2(helpers.job.payload, helpers)).toEqual(
      "if you want to live"
    );

    await release();
  }));
