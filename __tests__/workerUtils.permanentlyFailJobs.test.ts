import { makeWorkerUtils, WorkerSharedOptions } from "../src/index";
import {
  getJobs,
  makeSelectionOfJobs,
  reset,
  TEST_CONNECTION_STRING,
  withPgClient,
} from "./helpers";

/** For sorting arrays of numbers or numeric strings */
function numerically(a: string | number, b: string | number) {
  return parseFloat(String(a)) - parseFloat(String(b));
}

const options: WorkerSharedOptions = {};

test("completes the jobs, leaves others unaffected", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const { failedJob, regularJob1, lockedJob, regularJob2, untouchedJob } =
      await makeSelectionOfJobs(utils, pgClient);

    const jobs = [failedJob, regularJob1, lockedJob, regularJob2];
    const jobIds = jobs.map((j) => j.id).sort(numerically);

    const failedJobs = await utils.permanentlyFailJobs(jobIds, "TESTING!");
    const failedJobIds = failedJobs.map((j) => j.id).sort(numerically);
    expect(failedJobIds).toEqual(
      [failedJob.id, regularJob1.id, regularJob2.id].sort(numerically),
    );
    for (const j of failedJobs) {
      expect(j.last_error).toEqual("TESTING!");
      expect(j.attempts).toEqual(j.max_attempts);
      expect(j.attempts).toBeGreaterThan(0);
    }

    const remaining = await getJobs(pgClient, {
      where: `not (jobs.id = any($1))`,
      values: [failedJobIds],
    });
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toMatchObject(lockedJob);
    expect(remaining[1]).toMatchObject(untouchedJob);

    await utils.release();
  }));
