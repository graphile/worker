import {
  withPgClient,
  reset,
  TEST_CONNECTION_STRING,
  makeSelectionOfJobs,
} from "./helpers";
import { makeWorkerUtils, Job } from "../src/index";

/** For sorting arrays of numbers or numeric strings */
function numerically(a: string | number, b: string | number) {
  return parseFloat(String(a)) - parseFloat(String(b));
}

test("completes the jobs, leaves others unaffected", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const {
      failedJob,
      regularJob1,
      lockedJob,
      regularJob2,
      untouchedJob,
    } = await makeSelectionOfJobs(utils, pgClient);

    const jobs = [failedJob, regularJob1, lockedJob, regularJob2];
    const jobIds = jobs.map(j => j.id);

    const nowish = new Date(Date.now() + 60000);
    const rescheduledJobs = await utils.rescheduleJobs(jobIds, {
      runAt: nowish,
      attempts: 1,
    });
    const rescheduledJobIds = rescheduledJobs.map(j => j.id).sort(numerically);
    expect(rescheduledJobIds).toEqual(
      [failedJob.id, regularJob1.id, regularJob2.id].sort(numerically)
    );
    for (const j of rescheduledJobs) {
      expect(j.last_error).toEqual(
        j.id === failedJob.id ? "Failed forever" : null
      );
      expect(j.attempts).toEqual(1);
      expect(+j.run_at).toBeCloseTo(+nowish);
    }

    const { rows: remaining } = await pgClient.query<Job>(
      `select * from graphile_worker.jobs where not (id = any($1)) order by id asc`,
      [rescheduledJobIds]
    );
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toMatchObject(lockedJob);
    expect(remaining[1]).toMatchObject(untouchedJob);
  }));
