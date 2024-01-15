import {
  makeWorkerUtils,
  WorkerSharedOptions,
  WorkerUtils,
} from "../src/index";
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

let utils: WorkerUtils | null = null;
afterEach(async () => {
  await utils?.release();
  utils = null;
});

test("completes the jobs, leaves others unaffected", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const { failedJob, regularJob1, lockedJob, regularJob2, untouchedJob } =
      await makeSelectionOfJobs(utils, pgClient);

    const jobs = [failedJob, regularJob1, lockedJob, regularJob2];
    const jobIds = jobs.map((j) => j.id).sort(numerically);

    const completedJobs = await utils.completeJobs(jobIds);
    const completedJobIds = completedJobs.map((j) => j.id).sort(numerically);
    expect(completedJobIds).toEqual(
      [failedJob.id, regularJob1.id, regularJob2.id].sort(numerically),
    );

    const remaining = await getJobs(pgClient);
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toMatchObject(lockedJob);
    expect(remaining[1]).toMatchObject(untouchedJob);

    await utils.release();
    utils = null;
  }));
