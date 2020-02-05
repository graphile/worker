import {
  WithPgClient,
  Job,
  Helpers,
  TaskOptions,
  JobHelpers,
} from "./interfaces";
import { Pool, PoolClient } from "pg";
import { Logger } from "./logger";

export function makeAddJob(withPgClient: WithPgClient) {
  return (identifier: string, payload: any = {}, options: TaskOptions = {}) => {
    return withPgClient(async pgClient => {
      const { rows } = await pgClient.query(
        `
        select * from graphile_worker.add_job(
          identifier => $1::text,
          payload => $2::json,
          queue_name => coalesce($3::text, public.gen_random_uuid()::text),
          run_at => coalesce($4::timestamptz, now()),
          max_attempts => coalesce($5::int, 25),
          job_key => $6::text
        );
        `,
        [
          identifier,
          JSON.stringify(payload),
          options.queueName || null,
          options.runAt ? options.runAt.toISOString() : null,
          options.maxAttempts || null,
          options.jobKey || null,
        ]
      );
      const job: Job = rows[0];
      return job;
    });
  };
}

export function makeJobHelpers(
  job: Job,
  { withPgClient }: { withPgClient: WithPgClient },
  baseLogger: Logger
): JobHelpers {
  const jobLogger = baseLogger.scope({
    label: "job",
    taskIdentifier: job.task_identifier,
    jobId: job.id,
  });
  const helpers: JobHelpers = {
    job,
    logger: jobLogger,
    withPgClient,
    query: (queryText, values) =>
      withPgClient(pgClient => pgClient.query(queryText, values)),
    addJob: makeAddJob(withPgClient),

    // TODO: add an API for giving workers more helpers
  };

  // DEPRECATED METHODS
  Object.assign(helpers, {
    debug(format: string, ...parameters: any[]): void {
      jobLogger.error(
        "REMOVED: `helpers.debug` has been replaced with `helpers.logger.debug`; please do not use `helpers.debug`"
      );
      jobLogger.debug(format, { parameters });
    },
  } as any);

  return helpers;
}

export function makeWithPgClientFromPool(pgPool: Pool) {
  return async <T>(callback: (pgClient: PoolClient) => Promise<T>) => {
    const client = await pgPool.connect();
    try {
      return await callback(client);
    } finally {
      await client.release();
    }
  };
}

export function makeWithPgClientFromClient(pgClient: PoolClient) {
  return async <T>(callback: (pgClient: PoolClient) => Promise<T>) => {
    return callback(pgClient);
  };
}
