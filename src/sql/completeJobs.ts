import { DbJob, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

const manualPrepare = false;

export async function batchCompleteJobs(
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

  const jobIdsWithoutQueue: string[] = [];
  const jobIdsWithQueue: string[] = [];
  for (const job of jobs) {
    if (job.job_queue_id != null) {
      jobIdsWithQueue.push(job.id);
    } else {
      jobIdsWithoutQueue.push(job.id);
    }
  }

  if (jobIdsWithQueue.length > 0) {
    await withPgClient((client) =>
      client.execute(
        `\
with j as (
delete from ${escapedWorkerSchema}._private_jobs as jobs
using unnest($1::bigint[]) n(n)
where id = n
returning *
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_by = null, locked_at = null
from j
where job_queues.id = j.job_queue_id and job_queues.locked_by = $2::text;`,
        [jobIdsWithQueue, poolId],
        { prepare: preparedStatements },
      ),
    );
  }
  if (jobIdsWithoutQueue.length === 1) {
    await withPgClient((client) =>
      client.execute(
        `\
delete from ${escapedWorkerSchema}._private_jobs as jobs
where id = $1::bigint`,
        [jobIdsWithoutQueue[0]],
        { prepare: preparedStatements },
      ),
    );
  } else if (jobIdsWithoutQueue.length > 1) {
    if (manualPrepare) {
      await withPgClient((client) =>
        client.execute(
          `\
prepare gwcj (bigint) as delete from ${escapedWorkerSchema}._private_jobs where id = $1;
${jobIdsWithoutQueue.map((id) => `execute gwcj(${id});`).join("\n")}
deallocate gwcj;`,
        ),
      );
    } else {
      await withPgClient((client) =>
        client.execute(
          `\
delete from ${escapedWorkerSchema}._private_jobs as jobs
using unnest($1::bigint[]) n(n)
where id = n`,
          [jobIdsWithoutQueue],
          { prepare: preparedStatements },
        ),
      );
    }
  }
}
