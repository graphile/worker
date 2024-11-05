import {
  Job,
  makeWorkerUtils,
  WorkerSharedOptions,
  WorkerUtils,
} from "../src/index";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  getJobs,
  reset,
  TEST_CONNECTION_STRING,
  withPgClient,
} from "./helpers";

const options: WorkerSharedOptions = {};

let utils: WorkerUtils | null = null;
afterEach(async () => {
  await utils?.release();
  utils = null;
});

test("unlocks jobs for the given workers, leaves others unaffected", () =>
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
      [POOL_ID_1, null],
      [POOL_ID_1, "test"],
      [POOL_ID_2, null],
      [POOL_ID_2, "test2"],
      [POOL_ID_2, "test3"],
      [POOL_ID_3, null],
      [null, null],
      [null, "test"],
      [null, "test2"],
      [null, "test3"],
    ] as const;
    for (const [poolId, queueName] of specs) {
      date.setMinutes(date.getMinutes() - 1);
      const job = await utils.addJob(
        "job3",
        { a: ++a },
        { queueName: queueName ?? undefined },
      );
      await pgClient.query(
        `\
update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs
set locked_at = $1, locked_by = $2
where id = $3`,
        [poolId ? date.toISOString() : null, poolId, job.id],
      );
      jobs.push(job);
    }
    await pgClient.query(
      `\
update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues as job_queues
set locked_at = jobs.locked_at, locked_by = jobs.locked_by
from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs
where jobs.job_queue_id = job_queues.id;`,
    );
    await utils.forceUnlockWorkers([POOL_ID_2, POOL_ID_3]);

    const remaining = await getJobs(pgClient);
    remaining.sort((a, z) => Number(a.id) - Number(z.id));
    expect(remaining).toHaveLength(specs.length);
    for (let i = 0, l = specs.length; i < l; i++) {
      const spec = specs[i];
      const job = jobs[i];
      const updatedJob = remaining[i];
      expect(updatedJob.id).toEqual(job.id);
      if (spec[0] === POOL_ID_2 || spec[0] === POOL_ID_3) {
        expect(updatedJob.locked_by).toBeNull();
        expect(updatedJob.locked_at).toBeNull();
      } else if (spec[0]) {
        expect(updatedJob.locked_by).toEqual(spec[0]);
        expect(updatedJob.locked_at).toBeTruthy();
      } else {
        expect(updatedJob.locked_by).toBeNull();
        expect(updatedJob.locked_at).toBeNull();
      }
    }
    const { rows: lockedQueues } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues as job_queues where locked_at is not null order by id asc`,
    );

    expect(lockedQueues).toEqual([
      expect.objectContaining({
        queue_name: "test",
        locked_by: POOL_ID_1,
      }),
    ]);
  }));
