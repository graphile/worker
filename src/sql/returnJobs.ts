import { DbJob, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function returnJobs(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  poolId: string,
  jobs: ReadonlyArray<DbJob>,
): Promise<void> {
  const {
    escapedWorkerSchema,
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
    await withPgClient((client) =>
      client.query(
        `\
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
        [poolId, jobsWithQueues.map((job) => job.id)],
        { prepare: preparedStatements },
      ),
    );
  }
  if (jobsWithoutQueues.length > 0) {
    await withPgClient((client) =>
      client.query(
        `\
update ${escapedWorkerSchema}._private_jobs as jobs
set
attempts = GREATEST(0, attempts - 1),
locked_by = null,
locked_at = null
where id = ANY($2::bigint[])
and locked_by = $1::text;`,
        [poolId, jobsWithoutQueues.map((job) => job.id)],
        { prepare: preparedStatements },
      ),
    );
  }
}
