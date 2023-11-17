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
    resolvedPreset: {
      worker: { preparedStatements },
    },
  } = compiledSharedOptions;

  // TODO: retry logic, in case of server connection interruption
  await withPgClient((client) =>
    client.query({
      text: `SELECT FROM ${escapedWorkerSchema}.complete_job($1, $2);`,
      values: [workerId, job.id],
      name: !preparedStatements ? undefined : `complete_job/${workerSchema}`,
    }),
  );
}
