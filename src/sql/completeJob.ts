import { WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function completeJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerId: string,
  jobId: string,
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
delete from ${escapedWorkerSchema}.jobs
where id = $2
returning *
)
update ${escapedWorkerSchema}.job_queues
set locked_by = null, locked_at = null, is_available = true
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $1;`,
      values: [workerId, jobId],
      name: noPreparedStatements ? undefined : `complete_job/${workerSchema}`,
    }),
  );
}
