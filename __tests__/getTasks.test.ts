import getTasks from "../src/getTasks";
import { makeMockJob, withPgClient } from "./helpers";
import { makeHelpers, makeWithPgClientFromClient } from "../src/helpers";

test("gets tasks from folder", () =>
  withPgClient(async client => {
    const { tasks, release } = await getTasks(`${__dirname}/tasks`);
    expect(tasks).toBeTruthy();
    expect(Object.keys(tasks).sort()).toMatchInlineSnapshot(`
Array [
  "wouldyoulike",
  "wouldyoulike_default",
]
`);
    const job = makeMockJob("wouldyoulike");
    const helpers = makeHelpers(job, {
      withPgClient: makeWithPgClientFromClient(client)
    });
    expect(await tasks.wouldyoulike(job.payload, helpers)).toEqual(
      "some sausages"
    );
    expect(await tasks.wouldyoulike_default(job.payload, helpers)).toEqual(
      "some more sausages"
    );
    await release();
  }));
