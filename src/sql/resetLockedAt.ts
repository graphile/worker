import { EnhancedWithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function resetLockedAt(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: EnhancedWithPgClient,
): Promise<void> {
  const {
    escapedWorkerSchema,
    resolvedPreset: {
      worker: { preparedStatements, useNodeTime },
    },
  } = compiledSharedOptions;

  const now = useNodeTime ? "$1::timestamptz" : "now()";

  await withPgClient.withRetries((client) =>
    client.query(
      `\
with j as (
update ${escapedWorkerSchema}._private_jobs as jobs
set locked_at = null, locked_by = null, run_at = greatest(run_at, ${now})
where locked_at < ${now} - interval '4 hours'
)
update ${escapedWorkerSchema}._private_job_queues as job_queues
set locked_at = null, locked_by = null
where locked_at < ${now} - interval '4 hours'`,
      useNodeTime ? [new Date().toISOString()] : [],
      { prepare: preparedStatements },
    ),
  );
}
