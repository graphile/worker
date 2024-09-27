import { DbJob, EnhancedWithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function returnJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: EnhancedWithPgClient,
  poolId: string,
  jobs: ReadonlyArray<DbJob>,
): Promise<void> {
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements },
    },
  } = compiledSharedOptions;

  const jobsWithQueues: DbJob[] = [];
  const jobsWithoutQueues: DbJob[] = [];

  for (const job of jobs) {
    if (job.job_queue_id != null) {
      jobsWithQueues.push(job);
    } else {
      jobsWithoutQueues.push(job);
    }
  }

  if (jobsWithQueues.length > 0) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
with j as (
update ${escapedWorkerSchema}._private_jobs as jobs
set
attempts = GREATEST(0, attempts - 1),
locked_by = null,
locked_at = null
where id = ANY($2::bigint[])
and locked_by = $1::text
returning *
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $1::text;`,
        values: [poolId, jobsWithQueues.map((job) => job.id)],
        name: !preparedStatements ? undefined : `return_job_q/${workerSchema}`,
      }),
    );
  }
  if (jobsWithoutQueues.length > 0) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
update ${escapedWorkerSchema}._private_jobs as jobs
set
attempts = GREATEST(0, attempts - 1),
locked_by = null,
locked_at = null
where id = ANY($2::bigint[])
and locked_by = $1::text;`,
        values: [poolId, jobsWithoutQueues.map((job) => job.id)],
        name: !preparedStatements ? undefined : `return_job/${workerSchema}`,
      }),
    );
  }
}
