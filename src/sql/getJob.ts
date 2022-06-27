import { Job, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function getJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerId: string,
  supportedTaskNames: string[],
  useNodeTime: boolean,
  flagsToSkip: string[] | null,
): Promise<Job | undefined> {
  const {
    escapedWorkerSchema,
    workerSchema,
    options: { noPreparedStatements },
  } = compiledSharedOptions;

  const {
    rows: [jobRow],
  } = await withPgClient((client) =>
    // TODO: breaking change; change this to more optimal:
    // `SELECT id, queue_name, task_identifier, payload FROM ...`,
    client.query<Job>({
      text: `SELECT * FROM ${escapedWorkerSchema}.get_job($1, $2, forbidden_flags := $3::text[], now := coalesce($4::timestamptz, now()));`,
      values: [
        workerId,
        supportedTaskNames,
        flagsToSkip && flagsToSkip.length ? flagsToSkip : null,
        useNodeTime ? new Date().toISOString() : null,
      ],
      name: noPreparedStatements ? undefined : `get_job/${workerSchema}`,
    }),
  );
  return jobRow;
}
