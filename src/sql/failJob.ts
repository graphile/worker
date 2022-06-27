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
      text: `SELECT FROM ${escapedWorkerSchema}.fail_job($1, $2, $3);`,
      values: [workerId, jobId, message],
      name: noPreparedStatements ? undefined : `fail_job/${workerSchema}`,
    }),
  );
}
