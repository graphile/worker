import {
  makeWorkerUtils,
  WorkerSharedOptions,
  WorkerUtils,
} from "../src/index";
import { getJobs, makeSelectionOfJobs, reset, withPgClient } from "./helpers";

/** For sorting arrays of numbers or numeric strings */
function numerically(a: string | number, b: string | number) {
  return parseFloat(String(a)) - parseFloat(String(b));
}

const options: WorkerSharedOptions = {};

let utils: WorkerUtils | null = null;
afterEach(async () => {
  await utils?.release();
  utils = null;
});

test("completes the jobs, leaves others unaffected", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    utils = await makeWorkerUtils({
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
  }));
