import { run } from "../src";
import {
  EventMonitor,
  getJobs,
  HOUR,
  reset,
  SECOND,
  setupFakeTimers,
  sleep,
  withOptions,
} from "./helpers";

const { setTime } = setupFakeTimers();
const REFERENCE_TIMESTAMP = 1609459200000; /* 1st January 2021, 00:00:00 UTC */

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
    const runner = await run({
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
    await setTime(REFERENCE_TIMESTAMP + 4 * HOUR + 30 * SECOND); // 4:00:01am
    expect(cronScheduleCalls.count).toEqual(1);

    const { timestamp, jobsAndIdentifiers } = cronScheduleCalls.lastEvent!;
    expect(timestamp).toEqual(REFERENCE_TIMESTAMP + 4 * HOUR);
    expect(jobsAndIdentifiers).toHaveLength(1);
    expect(jobsAndIdentifiers[0].job.task).toEqual("my_task");

    // After this, the jobs should exist in the DB
    await cronScheduleComplete;
    await sleep(50);

    await runner.stop();

    {
      const jobs = await getJobs(pgPool);
      expect(jobs).toHaveLength(1);
    }
  }));
