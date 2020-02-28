import { withPgClient, reset, TEST_CONNECTION_STRING } from "./helpers";
import { makeWorkerUtils } from "../src/index";

/** For sorting arrays of numbers or numeric strings */
function numerically(a: string | number, b: string | number) {
  return parseFloat(String(a)) - parseFloat(String(b));
}

test("completes the jobs, leaves others unaffected", () =>
  withPgClient(async pgClient => {
    await reset(pgClient);

    // Schedule a job
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const failedJob = await utils.addJob("job1", { a: 1, runAt: future });
    const regularJob1 = await utils.addJob("job1", { a: 2, runAt: future });
    const lockedJob = await utils.addJob("job1", { a: 3, runAt: future });
    const regularJob2 = await utils.addJob("job1", { a: 4, runAt: future });
    const untouchedJob = await utils.addJob("job1", { a: 5, runAt: future });
    await pgClient.query(
      `update graphile_worker.jobs set locked_by = 'test', locked_at = now() where id = $1`,
      [lockedJob.id]
    );
    await pgClient.query(
      `update graphile_worker.jobs set attempts = max_attempts, last_error = 'Failed forever' where id = $1`,
      [failedJob.id]
    );

    const jobs = [failedJob, regularJob1, lockedJob, regularJob2];
    const jobIds = jobs.map(j => j.id).sort(numerically);
    const completedJobs = await utils.completeJobs(jobIds);
    const completedJobIds = completedJobs.map(j => j.id).sort(numerically);
    expect(completedJobIds).toEqual(
      [failedJob.id, regularJob1.id, regularJob2.id].sort(numerically)
    );

    // Assert that it has an entry in jobs / job_queues
    const { rows: remaining } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(remaining).toHaveLength(2);
    expect(remaining.map(r => r.id).sort(numerically)).toEqual([
      lockedJob.id,
      untouchedJob.id,
    ]);
  }));
