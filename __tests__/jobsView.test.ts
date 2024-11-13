import { Job, makeWorkerUtils, WorkerSharedOptions } from "../src";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  makeSelectionOfJobs,
  reset,
  withPgClient,
} from "./helpers";

const options: WorkerSharedOptions = {};

test("jobs view renders jobs", () =>
  withPgClient(async (pgClient, { TEST_CONNECTION_STRING }) => {
    await reset(pgClient, options);

    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    const jobs = Object.values(
      await makeSelectionOfJobs(utils, pgClient),
    ) as Job[];

    const { rows: jobsFromView } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs order by id asc`,
    );
    const queueNames: Record<number, string> = {};
    const { rows: queues } = await pgClient.query<{
      id: number;
      queue_name: string;
    }>(
      `select id, queue_name from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues`,
    );
    for (const queue of queues) {
      queueNames[queue.id] = queue.queue_name;
    }

    const l = jobs.length;
    expect(l).toBeGreaterThan(0);
    expect(jobsFromView).toHaveLength(l);
    for (let i = 0; i < l; i++) {
      const job = jobs[i];
      const jobFromView = jobsFromView[i];
      const { payload, is_available, job_queue_id, task_id, ...jobRest } = job;
      const { queue_name, ...jobFromViewRest } = jobFromView;
      expect(jobFromViewRest).toEqual(jobRest);
      if (job_queue_id == null) {
        expect(queue_name).toBeNull();
      } else {
        expect(queue_name).toEqual(queueNames[job_queue_id]);
      }
    }
    await utils.release();
  }));
