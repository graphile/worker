import { WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function failJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerId: string,
  jobId: string,
  message: string,
): Promise<void> {
  const {
    escapedWorkerSchema,
    workerSchema,
    options: { noPreparedStatements },
  } = compiledSharedOptions;

  // TODO: retry logic, in case of server connection interruption
  await withPgClient((client) =>
    client.query({
      text: `\
with j as (
update ${escapedWorkerSchema}.jobs
set
last_error = $3,
run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
locked_by = null,
locked_at = null,
updated_at = now(),
is_available = jobs.attempts < jobs.max_attempts
where id = $2 and locked_by = $1
returning *
)
update ${escapedWorkerSchema}.job_queues
set locked_by = null, locked_at = null, is_available = true
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $1;`,
      values: [workerId, jobId, message],
      name: noPreparedStatements ? undefined : `fail_job/${workerSchema}`,
    }),
  );
}
