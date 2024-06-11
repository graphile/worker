import { DbJob, EnhancedWithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function failJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: EnhancedWithPgClient,
  poolId: string,
  job: DbJob,
  message: string,
  replacementPayload: undefined | unknown[],
): Promise<void> {
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements },
    },
  } = compiledSharedOptions;

  // TODO: retry logic, in case of server connection interruption
  if (job.job_queue_id != null) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
with j as (
update ${escapedWorkerSchema}._private_jobs as jobs
set
last_error = $2::text,
run_at = greatest(now(), run_at) + (exp(least(attempts, 10)) * interval '1 second'),
locked_by = null,
locked_at = null,
payload = coalesce($4::json, jobs.payload)
where id = $1::bigint and locked_by = $3::text
returning *
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $3::text;`,
        values: [
          job.id,
          message,
          poolId,
          replacementPayload != null
            ? JSON.stringify(replacementPayload)
            : null,
        ],
        name: !preparedStatements ? undefined : `fail_job_q/${workerSchema}`,
      }),
    );
  } else {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
update ${escapedWorkerSchema}._private_jobs as jobs
set
last_error = $2::text,
run_at = greatest(now(), run_at) + (exp(least(attempts, 10)) * interval '1 second'),
locked_by = null,
locked_at = null,
payload = coalesce($4::json, jobs.payload)
where id = $1::bigint and locked_by = $3::text;`,
        values: [
          job.id,
          message,
          poolId,
          replacementPayload != null
            ? JSON.stringify(replacementPayload)
            : null,
        ],
        name: !preparedStatements ? undefined : `fail_job/${workerSchema}`,
      }),
    );
  }
}

export async function failJobs(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: EnhancedWithPgClient,
  poolId: string,
  jobs: DbJob[],
  message: string,
): Promise<DbJob[]> {
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements },
    },
  } = compiledSharedOptions;

  // TODO: retry logic, in case of server connection interruption
  const { rows: failedJobs } = await withPgClient.withRetries((client) =>
    client.query<DbJob>({
      text: `\
with j as (
update ${escapedWorkerSchema}._private_jobs as jobs
set
last_error = $2::text,
run_at = greatest(now(), run_at) + (exp(least(attempts, 10)) * interval '1 second'),
locked_by = null,
locked_at = null
where id = any($1::int[]) and locked_by = $3::text
returning *
), queues as (
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $3::text
)
select * from j;`,
      values: [jobs.map((job) => job.id), message, poolId],
      name: !preparedStatements ? undefined : `fail_jobs/${workerSchema}`,
    }),
  );
  return failedJobs;
}
