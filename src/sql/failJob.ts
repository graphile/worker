import { DbJob, WithPgClient } from "../interfaces";
import { CompiledSharedOptions } from "../lib";

export async function failJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerId: string,
  job: DbJob,
  message: string,
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
      text: `SELECT FROM ${escapedWorkerSchema}.fail_job($1, $2, $3);`,
      values: [workerId, job.id, message],
      name: !preparedStatements ? undefined : `fail_job/${workerSchema}`,
    }),
  );
}

export async function failJobs(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  workerIds: string[],
  jobs: DbJob[],
  message: string,
): Promise<DbJob[]> {
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements },
    },
  } = compiledSharedOptions;

  // TODO: retry logic, in case of server connection interruption
  const { rows: failedJobs } = await withPgClient((client) =>
    client.query<DbJob>({
      text: `\
with jobs_to_fail as (
  select job_id, jobs.locked_by
  from unnest($1::bigint[]) j(job_id)
  inner join ${escapedWorkerSchema}.jobs
  on (j.job_id = jobs.id)
  where jobs.locked_by = any($3::text[])
)
select fj.*
from jobs_to_fail jtf
inner join lateral ${escapedWorkerSchema}.fail_job(jtf.locked_by, jtf.job_id, $2) fj
on true;`,
      values: [jobs.map((job) => job.id), message, workerIds],
      name: !preparedStatements ? undefined : `fail_jobs/${workerSchema}`,
    }),
  );
  return failedJobs;
}
