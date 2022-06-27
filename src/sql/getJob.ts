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

  const common1 = `select jobs.queue_name, jobs.priority, jobs.run_at, jobs.id
    from ${escapedWorkerSchema}.jobs
    where jobs.locked_at is null
    and run_at <= ${now}
    and attempts < max_attempts
    and task_identifier = any($2::text[])
    ${flagsClause}`;
  const common2 = `order by priority asc, run_at asc, id asc
    limit 1
    for update
    skip locked`;

  const {
    rows: [jobRow],
  } = await withPgClient((client) =>
    // TODO: breaking change; change this to more optimal:
    // `SELECT id, queue_name, task_identifier, payload FROM ...`,
    client.query<Job>({
      text: `\
with p as (
  ${common1}
    and jobs.queue_name is null
    ${common2}
union
  ${common1}
    and exists (
      select 1
      from ${escapedWorkerSchema}.job_queues
      where job_queues.queue_name = jobs.queue_name
      and job_queues.locked_at is null
      for update
      skip locked
    )
    ${common2}
),
j as (
  select *
  from p
  order by priority asc, run_at asc, id asc
  limit 1
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
    returning *`,
      values: [
        workerId,
        supportedTaskNames,
        ...(hasFlags ? flagsToSkip! : []),
        ...(useNodeTime ? [new Date().toISOString()] : []),
      ],
      name: noPreparedStatements
        ? undefined
        : `get_job${hasFlags ? "F" : ""}${
            useNodeTime ? "N" : ""
          }/${workerSchema}`,
    }),
  );
  return jobRow;
}
