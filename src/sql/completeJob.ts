import { DbJob, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function completeJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerId: string,
  job: DbJob,
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
delete from ${escapedWorkerSchema}.jobs
where id = $1
returning *
)
update ${escapedWorkerSchema}.job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $2;`,
        values: [job.id, workerId],
        name: noPreparedStatements
          ? undefined
          : `complete_job_q/${workerSchema}`,
      }),
    );
  } else {
    await withPgClient((client) =>
      client.query({
        text: `\
delete from ${escapedWorkerSchema}.jobs
where id = $1`,
        values: [job.id],
        name: noPreparedStatements ? undefined : `complete_job/${workerSchema}`,
      }),
    );
  }
}
