import getTasks from "../src/getTasks";
import { makeMockJob, withPgClient } from "./helpers";
import { makeHelpers, makeWithPgClientFromClient } from "../src/helpers";

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
    const helpers = makeHelpers(makeMockJob("would you like"), {
      withPgClient: makeWithPgClientFromClient(client)
    });
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

    const helpers = makeHelpers(makeMockJob("task1"), {
      withPgClient: makeWithPgClientFromClient(client)
    });
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

    const helpers = makeHelpers(makeMockJob("t1"), {
      withPgClient: makeWithPgClientFromClient(client)
    });
    expect(await tasks.t1(helpers.job.payload, helpers)).toEqual(
      "come with me"
    );
    expect(await tasks.t2(helpers.job.payload, helpers)).toEqual(
      "if you want to live"
    );

    await release();
  }));
