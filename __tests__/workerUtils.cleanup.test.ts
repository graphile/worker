import {
  DbJob,
  Job,
  makeWorkerUtils,
  WorkerSharedOptions,
  WorkerUtils,
} from "../src/index";
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

let utils: WorkerUtils | null = null;
afterEach(async () => {
  await utils?.release();
  utils = null;
});

// Test DELETE_PERMAFAILED_JOBS
test("cleanup with DELETE_PERMAFAILED_JOBS", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    utils = await makeWorkerUtils({
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
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs order by id asc`,
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

    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    const jobs: Job[] = [];
    const POOL_ID_1 = "pool-1";
    const POOL_ID_2 = "pool-2";
    const POOL_ID_3 = "pool-3";
    let a = 0;
    const date = new Date();
    const specs = [
      [POOL_ID_1, "test", "test_job1"],
      [POOL_ID_2, "test2", "test_job2"],
      [POOL_ID_3, "test3", "test_job3"],
      [null, null, "test_job4"],
    ] as const;
    for (const [poolId, queueName, taskIdentifier] of specs) {
      date.setMinutes(date.getMinutes() - 1);
      const job = await utils.addJob(
        taskIdentifier,
        { a: ++a },
        { queueName: queueName ?? undefined },
      );
      jobs.push(job);
      if (poolId) {
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
          [date.toISOString(), poolId, job.id],
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

    await utils.forceUnlockWorkers([POOL_ID_3]);
    const thirdJob = jobs[2]; // Belongs to queueName 'task3'
    await utils.completeJobs([thirdJob.id]);
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

    utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });

    for (const taskIdentifier of [
      "job3",
      "test_job1",
      "test_job2",
      "test_job3",
      "test_job4",
    ]) {
      const job = await utils.addJob(taskIdentifier, {});
      if (["test_job2", "test_job4"].includes(taskIdentifier)) {
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
      "test_job4",
    ]);

    await utils.cleanup({
      tasks: ["GC_TASK_IDENTIFIERS"],
      taskIdentifiersToKeep: ["test_job4"],
    });
    const { rows: tasksAfter } = (await pgClient.query(
      `select identifier from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks`,
    )) as { rows: { identifier: string }[] };
    expect(tasksAfter.map((q) => q.identifier).sort()).toEqual([
      "job3",
      "test_job1",
      // test_job2 has been cleaned up
      "test_job3",
      "test_job4", // test_job4 would have been cleaned up, but we explicitly said to keep it
    ]);
  }));
