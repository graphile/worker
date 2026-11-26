import type { DbJob, WithPgClient } from "../interfaces.ts";
import type { CompiledSharedOptions } from "../lib.ts";

export async function returnJobs(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
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
    await withPgClient((client) =>
      client.query({
        text: `\
with deleted as (
delete from ${escapedWorkerSchema}._private_jobs as jobs
where id = ANY($2::bigint[])
and locked_by = $1::text
and key is null
and json_typeof(payload) != 'array'
and attempts >= max_attempts
and last_error is null
returning job_queue_id
),
j as (
update ${escapedWorkerSchema}._private_jobs as jobs
set
attempts = GREATEST(0, attempts - 1),
locked_by = null,
locked_at = null
where id = ANY($2::bigint[])
and locked_by = $1::text
and not (
  key is null
  and json_typeof(payload) != 'array'
  and attempts >= max_attempts
  and last_error is null
)
returning job_queue_id
),
all_queues as (
select job_queue_id from deleted
union
select job_queue_id from j
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from all_queues
where job_queues.id = all_queues.job_queue_id and job_queues.locked_by = $1::text;`,
        values: [poolId, jobsWithQueues.map((job) => job.id)],
        name: !preparedStatements ? undefined : `return_job_q/${workerSchema}`,
      }),
    );
  }
  if (jobsWithoutQueues.length > 0) {
    await withPgClient((client) =>
      client.query({
        text: `\
with deleted as (
delete from ${escapedWorkerSchema}._private_jobs as jobs
where id = ANY($2::bigint[])
and locked_by = $1::text
and key is null
and json_typeof(payload) != 'array'
and attempts >= max_attempts
and last_error is null
)
update ${escapedWorkerSchema}._private_jobs as jobs
set
attempts = GREATEST(0, attempts - 1),
locked_by = null,
locked_at = null
where id = ANY($2::bigint[])
and locked_by = $1::text
and not (
  key is null
  and json_typeof(payload) != 'array'
  and attempts >= max_attempts
  and last_error is null
);`,
        values: [poolId, jobsWithoutQueues.map((job) => job.id)],
        name: !preparedStatements ? undefined : `return_job/${workerSchema}`,
      }),
    );
  }
}
