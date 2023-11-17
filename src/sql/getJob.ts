import { DbJob, Job, TaskList, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export function isPromise<T>(t: T | Promise<T>): t is Promise<T> {
  return (
    typeof t === "object" &&
    t !== null &&
    typeof (t as Promise<unknown>).then === "function" &&
    typeof (t as Promise<unknown>).catch === "function"
  );
}

export async function getJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  tasks: TaskList,
  workerId: string,
  flagsToSkip: string[] | null,
): Promise<Job | undefined> {
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements, useNodeTime },
    },
    logger,
  } = compiledSharedOptions;

  const supportedTaskNames = Object.keys(tasks);
  if (supportedTaskNames.length === 0) {
    logger.error("No tasks found; nothing to do!");
    return undefined;
  }

  const {
    rows: [jobRow],
  } = await withPgClient((client) =>
    client.query<DbJob>({
      text:
        // TODO: breaking change; change this to more optimal:
        // `SELECT id, queue_name, task_identifier, payload FROM ...`,
        `SELECT * FROM ${escapedWorkerSchema}.get_job($1, $2, forbidden_flags := $3::text[], now := coalesce($4::timestamptz, now())); `,
      values: [
        workerId,
        supportedTaskNames,
        flagsToSkip && flagsToSkip.length ? flagsToSkip : null,
        useNodeTime ? new Date().toISOString() : null,
      ],
      name: !preparedStatements ? undefined : `get_job/${workerSchema}`,
    }),
  );

  if (jobRow) {
    return jobRow;
  } else {
    return undefined;
  }
}
