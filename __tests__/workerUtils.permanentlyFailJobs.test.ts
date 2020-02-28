import {
  withPgClient,
  reset,
  TEST_CONNECTION_STRING,
  makeSelectionOfJobs,
} from "./helpers";
import { makeWorkerUtils } from "../src/index";

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
    const jobIds = jobs.map(j => j.id).sort(numerically);

    const failedJobs = await utils.permanentlyFailJobs(jobIds, "TESTING!");
    const failedJobIds = failedJobs.map(j => j.id).sort(numerically);
    expect(failedJobIds).toEqual(
      [failedJob.id, regularJob1.id, regularJob2.id].sort(numerically)
    );
    for (const j of failedJobs) {
      expect(j.last_error).toEqual("TESTING!");
      expect(j.attempts).toEqual(j.max_attempts);
      expect(j.attempts).toBeGreaterThan(0);
    }

    const {
      rows: remaining,
    } = await pgClient.query(
      `select * from graphile_worker.jobs where not (id = any($1)) order by id asc`,
      [failedJobIds]
    );
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toMatchObject(lockedJob);
    expect(remaining[1]).toMatchObject(untouchedJob);
  }));
