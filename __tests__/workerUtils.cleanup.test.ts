import { DbJob, Job, makeWorkerUtils, WorkerSharedOptions } from "../src/index";
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

// Test DELETE_PERMAFAILED_JOBS
test("cleanup with DELETE_PERMAFAILED_JOBS", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const jobs = await makeSelectionOfJobs(utils, pgClient);
    const { failedJob, regularJob1, regularJob2 } = jobs;
    const permafailJobIds = [failedJob.id, regularJob1.id, regularJob2.id].sort(
      numerically,
    );
    const remainingJobIds = Object.values(jobs)
      .filter((r) => !permafailJobIds.includes(r.id))
      .map((r) => r.id)
      .sort(numerically);

    const failedJobs = await utils.permanentlyFailJobs(
      permafailJobIds,
      "TESTING!",
    );
    expect(failedJobs.length).toEqual(permafailJobIds.length);

    await utils.cleanup({ tasks: ["DELETE_PERMAFAILED_JOBS"] });
    const { rows } = await pgClient.query<DbJob>(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs`,
    );
    const jobIds = rows
      .map((r) => r.id)
      .filter((id) => !permafailJobIds.includes(id))
      .sort(numerically);
    expect(jobIds).toEqual(remainingJobIds);
  }));

test("cleanup with GC_JOB_QUEUES", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const jobs: Job[] = [];
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
    for (const [workerId, queueName, taskIdentifier] of specs) {
      date.setMinutes(date.getMinutes() - 1);
      const job = await utils.addJob(
        taskIdentifier,
        { a: ++a },
        { queueName: queueName ?? undefined },
      );
      jobs.push(job);
      if (workerId) {
        await pgClient.query(
          `\
with j as (
  update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs
  set locked_at = $1, locked_by = $2
  where id = $3
  returning *
), q as (
  update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues as job_queues
    set
      locked_by = $2::text,
      locked_at = $1
    from j
    where job_queues.id = j.job_queue_id
)
select * from j`,
          [date.toISOString(), workerId, job.id],
        );
      }
    }

    const { rows: queuesBefore } = await pgClient.query<{ queue_name: string }>(
      `select queue_name from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues`,
    );
    expect(queuesBefore.map((q) => q.queue_name).sort()).toEqual([
      "test",
      "test2",
      "test3",
    ]);

    await utils.forceUnlockWorkers(["worker3"]);
    const lastJob = jobs[jobs.length - 1]; // Belongs to queueName 'task3'
    await utils.completeJobs([lastJob.id]);
    await utils.cleanup({ tasks: ["GC_JOB_QUEUES"] });
    const { rows: queuesAfter } = await pgClient.query<{ queue_name: string }>(
      `select queue_name from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues`,
    );
    expect(queuesAfter.map((q) => q.queue_name).sort()).toEqual([
      "test",
      "test2",
    ]);
  }));

test("cleanup with GC_TASK_IDENTIFIERS", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    for (const taskIdentifier of [
      "job3",
      "test_job1",
      "test_job2",
      "test_job3",
    ]) {
      const job = await utils.addJob(taskIdentifier, {});
      if (taskIdentifier === "test_job2") {
        await utils.completeJobs([job.id]);
      }
    }

    const { rows: tasksBefore } = await pgClient.query<{ identifier: string }>(
      `select identifier from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks`,
    );
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
      "test_job3",
    ]);

    await utils.release();
  }));
