import { EventEmitter } from "events";

import {
  Task,
  TaskList,
  WorkerEvents,
  WorkerSharedOptions,
} from "../src/interfaces";
import { runTaskList } from "../src/main";
import { ESCAPED_GRAPHILE_WORKER_SCHEMA, reset, withPgPool } from "./helpers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const options: WorkerSharedOptions = {};

test("main will execute jobs as they come up, and exits cleanly", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);
    await pgPool.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), 'serial')`,
      ["unlocked"],
    );
    await pgPool.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), 'serial')`,
      ["locked_recently"],
    );
    await pgPool.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), 'serial')`,
      ["locked_ages_ago"],
    );
    await pgPool.query(
      `\
update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs
set
  locked_by = 'some_worker_id',
  locked_at = now() - (
    case payload->>'id'
    when 'locked_recently' then interval '5 minutes'
    else interval '4 hours 1 minute'
    end
  )
where task_id = (select id from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.tasks where identifier = 'job1') and payload->>'id' like 'locked_%';
`,
    );

    const job2: Task = jest.fn(({ id }: { id: string }) => {
      id;
    });
    const tasks: TaskList = {
      job2,
    };

    // Run the worker
    const events = new EventEmitter() as WorkerEvents;
    const workerPool = runTaskList(
      {
        concurrency: 3,
        minResetLockedInterval: 1,
        maxResetLockedInterval: 1,
        events,
      },
      tasks,
      pgPool,
    );
    const states: string[] = [];
    events.on("resetLocked:started", () => {
      states.push("started");
      workerPool.release();
    });
    events.on("resetLocked:success", () => {
      states.push("success");
    });
    events.on("resetLocked:failure", () => {
      states.push("failure");
    });
    await workerPool.promise;

    expect(states).toEqual(["started", "success"]);
    await sleep(20);
    const { rows: jobs } = await pgPool.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
    );
    expect(jobs.length).toEqual(3);
    const unlocked = jobs.find((j) => j.payload.id === "unlocked");
    const lockedRecently = jobs.find((j) => j.payload.id === "locked_recently");
    const lockedAgesAgo = jobs.find((j) => j.payload.id === "locked_ages_ago");
    expect(unlocked.locked_at).toBe(null);
    expect(unlocked.locked_by).toBe(null);
    expect(lockedRecently.locked_at).not.toBe(null);
    expect(lockedRecently.locked_by).not.toBe(null);
    expect(lockedAgesAgo.locked_at).toBe(null);
    expect(lockedAgesAgo.locked_by).toBe(null);
  }));
