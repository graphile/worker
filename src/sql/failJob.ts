import { DbJob, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function failJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerId: string,
  job: DbJob,
  message: string,
  replacementPayload: undefined | any[],
): Promise<void> {
  const {
    escapedWorkerSchema,
    workerSchema,
    options: { noPreparedStatements },
  } = compiledSharedOptions;

  // TODO: retry logic, in case of server connection interruption
  if (job.job_queue_id != null) {
    await withPgClient((client) =>
      client.query({
        text: `\
with j as (
update ${escapedWorkerSchema}.jobs
set
last_error = $2,
run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
locked_by = null,
locked_at = null,
payload = coalesce($4::json, jobs.payload)
where id = $1 and locked_by = $3
returning *
)
update ${escapedWorkerSchema}.job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $3;`,
        values: [
          job.id,
          message,
          workerId,
          replacementPayload != null
            ? JSON.stringify(replacementPayload)
            : null,
        ],
        name: noPreparedStatements ? undefined : `fail_job_q/${workerSchema}`,
      }),
    );
  } else {
    await withPgClient((client) =>
      client.query({
        text: `\
update ${escapedWorkerSchema}.jobs
set
last_error = $2,
run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
locked_by = null,
locked_at = null,
payload = coalesce($4::json, jobs.payload)
where id = $1 and locked_by = $3;`,
        values: [
          job.id,
          message,
          workerId,
          replacementPayload != null
            ? JSON.stringify(replacementPayload)
            : null,
        ],
        name: noPreparedStatements ? undefined : `fail_job/${workerSchema}`,
      }),
    );
  }
}
