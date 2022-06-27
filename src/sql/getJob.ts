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

  const now = useNodeTime ? "$4::timestamptz" : "now()";

  const {
    rows: [jobRow],
  } = await withPgClient((client) =>
    // TODO: breaking change; change this to more optimal:
    // `SELECT id, queue_name, task_identifier, payload FROM ...`,
    client.query<Job>({
      text: `\
with j as (
  select jobs.queue_name, jobs.id
    from ${escapedWorkerSchema}.jobs
    where jobs.locked_at is null
    and (
      jobs.queue_name is null
    or
      exists (
        select 1
        from ${escapedWorkerSchema}.job_queues
        where job_queues.queue_name = jobs.queue_name
        and job_queues.locked_at is null
        for update
        skip locked
      )
    )
    and run_at <= ${now}
    and attempts < max_attempts
    and task_identifier = any($2::text[])
    and ($3::text[] is null or (flags ?| $3::text[]) is not true)
    order by priority asc, run_at asc, id asc
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
    returning *`,
      values: [
        workerId,
        supportedTaskNames,
        flagsToSkip && flagsToSkip.length ? flagsToSkip : null,
        ...(useNodeTime ? [new Date().toISOString()] : []),
      ],
      name: noPreparedStatements
        ? undefined
        : `get_job${useNodeTime ? "N" : ""}/${workerSchema}`,
    }),
  );
  return jobRow;
}
