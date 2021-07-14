import { run, runTaskListOnce } from "../src";
import { Runner, WorkerSharedOptions } from "../src/interfaces";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  EventMonitor,
  getJobs,
  HOUR,
  reset,
  SECOND,
  setupFakeTimers,
  sleep,
  withOptions,
  withPgClient,
} from "./helpers";

const { setTime } = setupFakeTimers();
const REFERENCE_TIMESTAMP = 1609459200000; /* 1st January 2021, 00:00:00 UTC */

test("useNodeTime works for regular jobs", () =>
  withPgClient(async (pgClient) => {
    await setTime(REFERENCE_TIMESTAMP);
    const options: WorkerSharedOptions = {
      useNodeTime: true, // NOTE: Node.js time thinks we're in Jan 2021, but PostgreSQL knows we're not
    };
    await reset(pgClient, options);

    const job1 = jest.fn();
    const tasks = { job1 };

    // Schedule a job "in the future" according to Node (but in the past according to Postgres).
    const runAt = new Date(REFERENCE_TIMESTAMP + 3 * HOUR); // 03:00:00.000
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', '{"a": "wrong"}', run_at := '${runAt.toISOString()}', job_key := 'abc')`,
    );
    // Running the task list shouldn't execute the job because it's "in the future"
    await runTaskListOnce(options, tasks, pgClient);
    expect(job1).not.toHaveBeenCalled();

    // Now set our timestamp to be just after runAt and try again:
    await setTime(+runAt + 1); // 03:00:00.001
    await runTaskListOnce(options, tasks, pgClient);
    // This time the job should have ran
    expect(job1).toHaveBeenCalledTimes(1);
  }));

// This is just to give validation to the above test making sense.
test("validate the job would have run if not for useNodeTime", () =>
  withPgClient(async (pgClient) => {
    await setTime(REFERENCE_TIMESTAMP);
    const options: WorkerSharedOptions = {
      useNodeTime: false,
    };
    await reset(pgClient, options);

    const job1 = jest.fn();
    const tasks = { job1 };

    // Schedule a job "in the future" according to Node (but in the past according to Postgres).
    const runAt = new Date(REFERENCE_TIMESTAMP + 3 * HOUR); // 03:00:00.000
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', '{"a": "wrong"}', run_at := '${runAt.toISOString()}', job_key := 'abc')`,
    );
    // Running the task list SHOULD execute the job because, according to PostgreSQL, it's in the past.
    await runTaskListOnce(options, tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);
  }));

// Even on test fail we need the runner to shut down, so clean up after each test (rather than during).
let runner: null | Runner = null;
afterEach(() => {
  if (runner) {
    const promise = runner.stop();
    runner = null;
    return promise;
  }
});

// Note: cron always works with Node time anyway, but this is for completeness.
test("useNodeTime works for cron jobs", () =>
  withOptions(async (options) => {
    const pgPool = options.pgPool;
    await setTime(REFERENCE_TIMESTAMP + HOUR); // 1am
    await reset(pgPool, options);
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const poolReady = eventMonitor.awaitNext("pool:listen:success");
    const cronScheduleCalls = eventMonitor.count("cron:schedule");
    const cronScheduleComplete = eventMonitor.awaitNext("cron:scheduled");
    runner = await run({
      ...options,
      crontab: `0 */4 * * * my_task`,
      events: eventMonitor.events,
      useNodeTime: true,
    });
    await cronFinishedBackfilling;
    await poolReady;
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR - 10 * SECOND); // 3:59:50am
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR - 5 * SECOND); // 3:59:55am
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR + 1 * SECOND); // 4:00:01am
    expect(cronScheduleCalls.count).toEqual(1);

    const { timestamp, jobsAndIdentifiers } = cronScheduleCalls.lastEvent!;
    expect(timestamp).toEqual(REFERENCE_TIMESTAMP + 4 * HOUR);
    expect(jobsAndIdentifiers).toHaveLength(1);
    expect(jobsAndIdentifiers[0].job.task).toEqual("my_task");

    // After this, the jobs should exist in the DB
    await cronScheduleComplete;
    await sleep(50);

    {
      const jobs = await getJobs(pgPool);
      expect(jobs).toHaveLength(1);
    }
  }));
