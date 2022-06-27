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
      text: `SELECT FROM ${escapedWorkerSchema}.complete_job($1, $2);`,
      values: [workerId, jobId],
      name: noPreparedStatements ? undefined : `complete_job/${workerSchema}`,
    }),
  );
}
