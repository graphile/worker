import { withPgClient, reset, TEST_CONNECTION_STRING } from "./helpers";
import { makeWorkerUtils, Job } from "../src/index";

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
    let failedJob = await utils.addJob("job1", { a: 1, runAt: future });
    const regularJob1 = await utils.addJob("job1", { a: 2, runAt: future });
    let lockedJob = await utils.addJob("job1", { a: 3, runAt: future });
    const regularJob2 = await utils.addJob("job1", { a: 4, runAt: future });
    const untouchedJob = await utils.addJob("job1", { a: 5, runAt: future });
    ({
      rows: [lockedJob],
    } = await pgClient.query<Job>(
      `update graphile_worker.jobs set locked_by = 'test', locked_at = now() where id = $1 returning *`,
      [lockedJob.id]
    ));
    ({
      rows: [failedJob],
    } = await pgClient.query<Job>(
      `update graphile_worker.jobs set attempts = max_attempts, last_error = 'Failed forever' where id = $1 returning *`,
      [failedJob.id]
    ));

    const jobs = [failedJob, regularJob1, lockedJob, regularJob2];
    const jobIds = jobs.map(j => j.id).sort(numerically);
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

    // Assert that it has an entry in jobs / job_queues
    const {
      rows: remaining,
    } = await pgClient.query(
      `select * from graphile_worker.jobs where not (id = any($1)) order by id asc`,
      [rescheduledJobIds]
    );
    expect(remaining).toHaveLength(2);
    expect(remaining[0]).toMatchObject(lockedJob);
    expect(remaining[1]).toMatchObject(untouchedJob);
  }));
