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

  let i = 2;
  const hasFlags = flagsToSkip && flagsToSkip.length > 0;
  const flagsClause = hasFlags
    ? `and ((flags ?| $${++i}::text[]) is not true)`
    : "";
  const now = useNodeTime ? `$${++i}::timestamptz` : "now()";

  const queueClause = `and (
      jobs.queue_name is null
      or exists (
        select 1
        from ${escapedWorkerSchema}.job_queues
        where job_queues.queue_name = jobs.queue_name
        and job_queues.locked_at is null
        for update
        skip locked
      )
    )`;
  const text = `\
with j as (
  select jobs.queue_name, jobs.priority, jobs.run_at, jobs.id
    from ${escapedWorkerSchema}.jobs
    where jobs.locked_at is null
    and run_at <= ${now}
    and attempts < max_attempts
    and task_identifier = any($2::text[])
    ${queueClause}
    ${flagsClause}
    order by priority asc, run_at asc
    limit 1
    for update
    skip locked
),
q as (
  update ${escapedWorkerSchema}.job_queues
    set
      locked_by = $1::text,
      locked_at = ${now}
    from j
    where job_queues.queue_name = j.queue_name
)
  update ${escapedWorkerSchema}.jobs
    set
      attempts = jobs.attempts + 1,
      locked_by = $1::text,
      locked_at = ${now}
    from j
    where jobs.id = j.id
    returning *`;
  const values = [
    workerId,
    supportedTaskNames,
    ...(hasFlags ? [flagsToSkip!] : []),
    ...(useNodeTime ? [new Date().toISOString()] : []),
  ];
  const name = noPreparedStatements
    ? undefined
    : `get_job${hasFlags ? "F" : ""}${useNodeTime ? "N" : ""}/${workerSchema}`;

  const {
    rows: [jobRow],
  } = await withPgClient((client) =>
    // TODO: breaking change; change this to more optimal:
    // `SELECT id, queue_name, task_identifier, payload FROM ...`,
    client.query<Job>({
      text,
      values,
      name,
    }),
  );
  return jobRow;
}
