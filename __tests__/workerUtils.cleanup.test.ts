import { Job, makeWorkerUtils, WorkerSharedOptions } from "../src/index";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
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

test("cleanup the database", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const {
      failedJob,
      regularJob1,
      lockedJob,
      regularJob2,
    } = await makeSelectionOfJobs(utils, pgClient);
    const jobs = [failedJob, regularJob1, lockedJob, regularJob2];
    const jobIds = jobs.map((j) => j.id).sort(numerically);

    // Test DELETE_PERMAFAILED_JOBS
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

    await utils.cleanup({ tasks: ["DELETE_PERMAFAILED_JOBS"] });
    const { rows: jobsFromView } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs`,
    );
    failedJobIds.forEach((id) =>
      expect(jobsFromView.find((j) => j.id === id)).toBeUndefined(),
    );

    const jobs2: Job[] = [];
    const WORKER_ID_1 = "worker1";
    const WORKER_ID_2 = "worker2";
    const WORKER_ID_3 = "worker3";
    let a = 0;
    const date = new Date();
    const specs = [
      [WORKER_ID_1, "test", "test_job1"],
      [WORKER_ID_2, "test2", "test_job2"],
      [WORKER_ID_3, "test3", "test_job3"],
    ] as const;
    for (const [workerId, queueName, jobId] of specs) {
      date.setMinutes(date.getMinutes() - 1);
      const job = await utils.addJob(
        jobId,
        { a: ++a },
        { queueName: queueName ?? undefined },
      );
      await pgClient.query(
        `
        update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs
        set locked_at = $1, locked_by = $2
        where id = $3`,
        [workerId ? date.toISOString() : null, workerId, job.id],
      );
      jobs2.push(job);
    }

    // Test GC_JOB_QUEUES
    const { rows: queuesBefore } = (await pgClient.query(
      `select queue_name from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues`,
    )) as { rows: { queue_name: string }[] };
    expect(queuesBefore.map((q) => q.queue_name).sort()).toEqual([
      "test",
      "test2",
      "test3",
    ]);

    await utils.forceUnlockWorkers(["worker3"]);
    await utils.completeJobs([jobs2[jobs2.length - 1].id]);
    await utils.cleanup({ tasks: ["GC_JOB_QUEUES"] });
    const { rows: queuesAfter } = (await pgClient.query(
      `select queue_name from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues`,
    )) as { rows: { queue_name: string }[] };
    expect(queuesAfter.map((q) => q.queue_name).sort()).toEqual([
      "test",
      "test2",
    ]);

    // Test GC_TASK_IDENTIFIERS
    const { rows: tasksBefore } = (await pgClient.query(
      `select identifier from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks`,
    )) as { rows: { identifier: string }[] };
    expect(tasksBefore.map((q) => q.identifier).sort()).toEqual([
      "job3",
      "test_job1",
      "test_job2",
      "test_job3",
    ]);

    await utils.cleanup({ tasks: ["GC_TASK_IDENTIFIERS"] });
    const { rows: tasksAfter } = (await pgClient.query(
      `select identifier from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks`,
    )) as { rows: { identifier: string }[] };
    expect(tasksAfter.map((q) => q.identifier).sort()).toEqual([
      "job3",
      "test_job1",
      "test_job2",
    ]);

    await utils.release();
  }));
