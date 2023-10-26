import { run } from "../src";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  EventMonitor,
  getJobs,
  getKnown,
  reset,
  withOptions,
} from "./helpers";

const CRONTAB_DO_IT = `
0 */4 * * * do_it ?fill=1d
`;
const FOUR_HOURS = 4 * 60 * 60 * 1000;

test("registers identifiers", () =>
  withOptions(async (options) => {
    const { pgPool } = options;
    await reset(pgPool, options);
    {
      const known = await getKnown(pgPool);
      expect(known).toHaveLength(0);
    }
    const runner = await run({
      ...options,
      crontab: CRONTAB_DO_IT,
    });
    await runner.stop();
    {
      const known = await getKnown(pgPool);
      expect(known).toHaveLength(1);
      expect(known[0].identifier).toEqual("do_it");
      expect(known[0].known_since).not.toBeNull();
      expect(known[0].last_execution).toBeNull();
      const jobs = await getJobs(pgPool);
      expect(jobs).toHaveLength(0);
    }
  }));

test("backfills if identifier already registered (5h)", () =>
  withOptions(async (options) => {
    const { pgPool } = options;
    await reset(pgPool, options);
    const now = Date.now();
    const expectedTime = now - (now % FOUR_HOURS);
    await pgPool.query(
      `
        insert into ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_known_crontabs as known_crontabs (
          identifier,
          known_since,
          last_execution
        )
        values (
          'do_it',
          NOW() - interval '14 days',
          NOW() - interval '5 hours'
        )
      `,
    );
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const runner = await run({
      ...options,
      crontab: CRONTAB_DO_IT,
      events: eventMonitor.events,
    });
    await cronFinishedBackfilling;
    await runner.stop();
    {
      const known = await getKnown(pgPool);
      expect(known).toHaveLength(1);
      expect(known[0].identifier).toEqual("do_it");
      expect(known[0].known_since).not.toBeNull();
      if (!known[0].last_execution) {
        throw new Error("Expected last_execution to exist");
      }
      // There's a small window every 4 hours where the expect might fail due
      // to the clock advancing, so we account for that by checking both of the
      // expected times.
      const lx = +known[0].last_execution;
      if (lx !== expectedTime && lx !== expectedTime + FOUR_HOURS) {
        // If we get here, then neither of the above were okay.
        expect(+known[0].last_execution).toEqual(expectedTime);
      }
      const jobs = await getJobs(pgPool);
      // It's a 5 hour window for a job that runs every 4 hours, there should
      // be 1 or 2 jobs.
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs.length).toBeLessThanOrEqual(2);
      expect(jobs[0].task_identifier).toEqual("do_it");
    }
  }));

test("backfills if identifier already registered (25h)", () =>
  withOptions(async (options) => {
    const { pgPool } = options;
    await reset(pgPool, options);
    const now = Date.now();
    const expectedTime = now - (now % FOUR_HOURS);
    await pgPool.query(
      `
        insert into ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_known_crontabs as known_crontabs (
          identifier,
          known_since,
          last_execution
        )
        values (
          'do_it',
          NOW() - interval '14 days',
          NOW() - interval '25 hours'
        )
      `,
    );
    const eventMonitor = new EventMonitor();
    const cronFinishedBackfilling = eventMonitor.awaitNext("cron:started");
    const runner = await run({
      ...options,
      crontab: CRONTAB_DO_IT,
      events: eventMonitor.events,
    });
    await cronFinishedBackfilling;
    await runner.stop();
    {
      const known = await getKnown(pgPool);
      expect(known).toHaveLength(1);
      expect(known[0].identifier).toEqual("do_it");
      expect(known[0].known_since).not.toBeNull();
      if (!known[0].last_execution) {
        throw new Error("Expected last_execution to exist");
      }
      // There's a small window every 4 hours where the expect might fail due
      // to the clock advancing, so we account for that by checking both of the
      // expected times.
      const lx = +known[0].last_execution;
      if (lx !== expectedTime && lx !== expectedTime + FOUR_HOURS) {
        // If we get here, then neither of the above were okay.
        expect(+known[0].last_execution).toEqual(expectedTime);
      }
      const jobs = await getJobs(pgPool);
      // It's a 25 hour window for a job that runs every 4 hours, there should
      // be 6 or 7 jobs
      expect(jobs.length).toBeGreaterThanOrEqual(6);
      expect(jobs.length).toBeLessThanOrEqual(7);
      expect(jobs.every((j) => j.task_identifier === "do_it")).toBe(true);
    }
  }));
