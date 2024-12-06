import { DbJob, EnhancedWithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";
interface Spec {
  job: DbJob;
  message: string;
  replacementPayload: undefined | unknown[];
}

export async function failJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: EnhancedWithPgClient,
  poolId: string,
  specs: ReadonlyArray<Spec>,
): Promise<void> {
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements },
    },
  } = compiledSharedOptions;

  const specsWithQueues: Spec[] = [];
  const specsWithoutQueues: Spec[] = [];

  for (const spec of specs) {
    if (spec.job.job_queue_id != null) {
      specsWithQueues.push(spec);
    } else {
      specsWithoutQueues.push(spec);
    }
  }

  // TODO: retry logic, in case of server connection interruption
  if (specsWithQueues.length > 0) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
with j as (
update ${escapedWorkerSchema}._private_jobs as jobs
set
last_error = (el->>'message'),
run_at = greatest(now(), run_at) + (exp(least(attempts, 10)) * interval '1 second'),
locked_by = null,
locked_at = null,
payload = coalesce(el->'payload', jobs.payload)
from json_array_elements($2::json) as els(el)
where id = (el->>'jobId')::bigint and locked_by = $1::text
returning *
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $1::text;`,
        values: [
          poolId,
          JSON.stringify(
            specsWithQueues.map(({ job, message, replacementPayload }) => ({
              jobId: job.id,
              message,
              payload: replacementPayload,
            })),
          ),
        ],
        name: !preparedStatements ? undefined : `fail_job_q/${workerSchema}`,
      }),
    );
  }
  if (specsWithoutQueues.length > 0) {
    await withPgClient.withRetries((client) =>
      client.query({
        text: `\
update ${escapedWorkerSchema}._private_jobs as jobs
set
last_error = (el->>'message'),
run_at = greatest(now(), run_at) + (exp(least(attempts, 10)) * interval '1 second'),
locked_by = null,
locked_at = null,
payload = coalesce(el->'payload', jobs.payload)
from json_array_elements($2::json) as els(el)
where id = (el->>'jobId')::bigint and locked_by = $1::text;`,
        values: [
          poolId,
          JSON.stringify(
            specsWithoutQueues.map(({ job, message, replacementPayload }) => ({
              jobId: job.id,
              message,
              payload: replacementPayload,
            })),
          ),
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
