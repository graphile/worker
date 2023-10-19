import { run, Runner } from "../src";
import {
  EventMonitor,
  getJobs,
  HOUR,
  MINUTE,
  reset,
  SECOND,
  setupFakeTimers,
  sleep,
  withOptions,
} from "./helpers";

const { setTime } = setupFakeTimers();
const REFERENCE_TIMESTAMP = 1609459200000; /* 1st January 2021, 00:00:00 UTC */

// Even on test fail we need the runner to shut down, so clean up after each test (rather than during).
let runner: null | Runner = null;
afterEach(() => {
  if (runner) {
    const promise = runner.stop();
    runner = null;
    return promise;
  }
});

test("check timestamp is correct", () => {
  setTime(REFERENCE_TIMESTAMP);
  expect(new Date().toISOString()).toMatch(/^2021-01-01T00:00:0.*Z$/);
});

test("executes job when expected", () =>
  withOptions(async (options) => {
    await setTime(REFERENCE_TIMESTAMP + HOUR); // 1am
    const { pgPool } = options;
    await reset(pgPool, options);
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const poolReady = eventMonitor.awaitNext("pool:listen:success");
    const cronScheduleCalls = eventMonitor.count("cron:schedule");
    runner = await run({
      ...options,
      crontab: `0 */4 * * * my_task`,
      events: eventMonitor.events,
    });
    await cronFinishedBackfilling;
    await poolReady;
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 3 * HOUR + 1 * SECOND); // 3:00:01am
    expect(cronScheduleCalls.count).toEqual(0);

    const cronScheduleComplete = eventMonitor.awaitNext("cron:scheduled");
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

test("doesn't schedule tasks twice when system clock reverses", () =>
  withOptions(async (options) => {
    await setTime(REFERENCE_TIMESTAMP + HOUR); // 1am
    const { pgPool } = options;
    await reset(pgPool, options);
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const poolReady = eventMonitor.awaitNext("pool:listen:success");
    const cronScheduleCalls = eventMonitor.count("cron:schedule");
    runner = await run({
      ...options,
      crontab: `0 */4 * * * my_task`,
      events: eventMonitor.events,
    });
    await cronFinishedBackfilling;
    await poolReady;
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 3 * HOUR + 1 * SECOND); // 3:00:01am
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR + 1 * SECOND); // 4:00:01am
    expect(cronScheduleCalls.count).toEqual(1);

    // REWIND TIME!
    await setTime(REFERENCE_TIMESTAMP + 3 * HOUR + 1 * SECOND);
    // Advance time again
    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR + 1 * SECOND);
    // Although the time was matched again, no tasks should have been scheduled
    expect(cronScheduleCalls.count).toEqual(1);
  }));

test("clock skew doesn't prevent task from being scheduled at the right time", () =>
  withOptions(async (options) => {
    await setTime(REFERENCE_TIMESTAMP + HOUR); // 1am
    const { pgPool } = options;
    await reset(pgPool, options);
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const poolReady = eventMonitor.awaitNext("pool:listen:success");
    const cronScheduleCalls = eventMonitor.count("cron:schedule");
    runner = await run({
      ...options,
      crontab: `0 */4 * * * my_task`,
      events: eventMonitor.events,
    });
    await cronFinishedBackfilling;
    await poolReady;
    expect(cronScheduleCalls.count).toEqual(0);

    await setTime(REFERENCE_TIMESTAMP + 3 * HOUR + 1 * SECOND); // 3:00:01am
    expect(cronScheduleCalls.count).toEqual(0);

    // Advance time
    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR - 30 * SECOND); // 3:59:30am
    expect(cronScheduleCalls.count).toEqual(0);

    // Jump back and forward a few times
    for (let i = 0; i < 10; i++) {
      await setTime(REFERENCE_TIMESTAMP + 4 * HOUR - 1 * MINUTE); // 3:59:00am
      expect(cronScheduleCalls.count).toEqual(0);

      await setTime(REFERENCE_TIMESTAMP + 4 * HOUR - 30 * SECOND); // 3:59:30am
      expect(cronScheduleCalls.count).toEqual(0);
    }

    // Finally advance the clock to cron firing
    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR + 1 * SECOND); // 4:00:01am
    expect(cronScheduleCalls.count).toEqual(1);
  }));

test("does not schedule duplicate jobs when a job key is supplied", () =>
  withOptions(async (options) => {
    await setTime(REFERENCE_TIMESTAMP + HOUR); // 1am
    const { pgPool } = options;
    await reset(pgPool, options);
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const poolReady = eventMonitor.awaitNext("pool:listen:success");
    runner = await run({
      ...options,
      crontab: `0 */4 * * * my_task ?jobKey=foo`,
      events: eventMonitor.events,
    });
    await cronFinishedBackfilling;
    await poolReady;

    const cronScheduleComplete = eventMonitor.awaitNext("cron:scheduled");

    const cronScheduleCalls = eventMonitor.count("cron:schedule");
    // Allow the first copy of the job to get scheduled
    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR + 1 * SECOND); // 4:00:01am
    expect(cronScheduleCalls.count).toEqual(1);
    // Makes the test more reliable, due to separate connections to Postgres being slightly out of sync
    await sleep(150);
    const jobs = await getJobs(pgPool);
    expect(jobs).toEqual([
      expect.objectContaining({ task_identifier: "my_task", key: "foo" }),
    ]);

    // Allow the system to reschedule the job after seeing it wasn't picked up
    await setTime(REFERENCE_TIMESTAMP + 8 * HOUR + 1 * SECOND); // 8:00:01am
    expect(cronScheduleCalls.count).toEqual(2);
    // Makes the test more reliable, due to separate connections to Postgres being slightly out of sync
    await sleep(150);
    const jobs2 = await getJobs(pgPool);
    expect(jobs2).toEqual([
      expect.objectContaining({
        task_identifier: "my_task",
        key: "foo",
        id: jobs[0].id,
      }),
    ]);
    // Original job at 4am
    expect(jobs[0].payload._cron.ts).toEqual("2021-01-01T04:00:00.000Z");
    // Check the job is actually updated, should be 8am now
    expect(jobs2[0].payload._cron.ts).toEqual("2021-01-01T08:00:00.000Z");

    // After this, the jobs should exist in the DB
    await cronScheduleComplete;
    await sleep(50);
  }));
