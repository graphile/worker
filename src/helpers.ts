import {
  WithPgClient,
  Job,
  TaskSpec,
  JobHelpers,
  WorkerSharedOptions,
} from "./interfaces";
import { Pool, PoolClient } from "pg";
import { processSharedOptions } from "./lib";

export function makeAddJob(
  options: WorkerSharedOptions,
  withPgClient: WithPgClient
) {
  const { escapedWorkerSchema } = processSharedOptions(options);
  return (identifier: string, payload: any = {}, spec: TaskSpec = {}) => {
    return withPgClient(async pgClient => {
      const { rows } = await pgClient.query(
        `
        select * from ${escapedWorkerSchema}.add_job(
          identifier => $1::text,
          payload => $2::json,
          queue_name => $3::text,
          run_at => $4::timestamptz,
          max_attempts => $5::int,
          job_key => $6::text,
          priority => $7::int
        );
        `,
        [
          identifier,
          JSON.stringify(payload),
          spec.queueName || null,
          spec.runAt ? spec.runAt.toISOString() : null,
          spec.maxAttempts || null,
          spec.jobKey || null,
          spec.priority || null,
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
  options: WorkerSharedOptions
): JobHelpers {
  const { logger } = processSharedOptions(options, {
    scope: {
      label: "job",
      taskIdentifier: job.task_identifier,
      jobId: job.id,
    },
  });
  const helpers: JobHelpers = {
    job,
    logger,
    withPgClient,
    query: (queryText, values) =>
      withPgClient(pgClient => pgClient.query(queryText, values)),
    addJob: makeAddJob(options, withPgClient),

    // TODO: add an API for giving workers more helpers
  };

  // DEPRECATED METHODS
  Object.assign(helpers, {
    debug(format: string, ...parameters: any[]): void {
      logger.error(
        "REMOVED: `helpers.debug` has been replaced with `helpers.logger.debug`; please do not use `helpers.debug`"
      );
      logger.debug(format, { parameters });
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
