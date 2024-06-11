import { DbJob, EnhancedWithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function completeJob(
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

  const jobIdsWithoutQueue: string[] = [];
  const jobIdsWithQueue: string[] = [];
  for (const job of jobs) {
    if (job.job_queue_id != null) {
      jobIdsWithQueue.push(job.id);
    } else {
      jobIdsWithoutQueue.push(job.id);
    }
  }

  // TODO: retry logic, in case of server connection interruption
  if (jobIdsWithQueue.length > 0) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
with j as (
delete from ${escapedWorkerSchema}._private_jobs as jobs
where id = ANY($1::bigint[])
returning *
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $2::text;`,
        values: [jobIdsWithQueue, poolId],
        name: !preparedStatements
          ? undefined
          : `complete_job_q/${workerSchema}`,
      }),
    );
  }
  if (jobIdsWithoutQueue.length > 0) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
delete from ${escapedWorkerSchema}._private_jobs as jobs
where id = ANY($1::bigint[])`,
        values: [jobIdsWithoutQueue],
        name: !preparedStatements ? undefined : `complete_job/${workerSchema}`,
      }),
    );
  }
}
