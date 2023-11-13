import { Pool, PoolClient } from "pg";

import { AddJobFunction, Job, JobHelpers, WithPgClient } from "./interfaces";
import { CompiledSharedOptions, processSharedOptions } from "./lib";
import { Logger } from "./logger";

export function makeAddJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
): AddJobFunction {
  const { escapedWorkerSchema, useNodeTime } = compiledSharedOptions;
  return (identifier, payload, spec = {}) => {
    return withPgClient(async (pgClient) => {
      const { rows } = await pgClient.query(
        `
        select * from ${escapedWorkerSchema}.add_job(
          identifier => $1::text,
          payload => $2::json,
          queue_name => $3::text,
          run_at => $4::timestamptz,
          max_attempts => $5::int,
          job_key => $6::text,
          priority => $7::int,
          flags => $8::text[],
          job_key_mode => $9::text
        );
        `,
        [
          identifier,
          JSON.stringify(payload ?? {}),
          spec.queueName || null,
          // If there's an explicit run at, use that. Otherwise, if we've been
          // told to use Node time, use the current timestamp. Otherwise we'll
          // pass null and the function will use `now()` internally.
          spec.runAt
            ? spec.runAt.toISOString()
            : useNodeTime
            ? new Date().toISOString()
            : null,
          spec.maxAttempts || null,
          spec.jobKey || null,
          spec.priority || null,
          spec.flags || null,
          spec.jobKeyMode || null,
        ],
      );
      const job: Job = rows[0];
      job.task_identifier = identifier;
      return job;
    });
  };
}

export function makeJobHelpers(
  compiledSharedOptions: CompiledSharedOptions,
  job: Job,
  {
    withPgClient,
    abortSignal,
    logger: overrideLogger,
  }: {
    withPgClient: WithPgClient;
    abortSignal: AbortSignal | undefined;
    logger?: Logger;
  },
): JobHelpers {
  const baseLogger = overrideLogger ?? compiledSharedOptions.logger;
  const logger = baseLogger.scope({
    label: "job",
    taskIdentifier: job.task_identifier,
    jobId: job.id,
  });
  const helpers: JobHelpers = {
    abortSignal,
    job,
    logger,
    withPgClient,
    query: (queryText, values) =>
      withPgClient((pgClient) => pgClient.query(queryText, values)),
    addJob: makeAddJob(compiledSharedOptions, withPgClient),

    // TODO: add an API for giving workers more helpers
  };

  // DEPRECATED METHODS
  Object.assign(helpers, {
    debug(format: string, ...parameters: unknown[]): void {
      logger.error(
        "REMOVED: `helpers.debug` has been replaced with `helpers.logger.debug`; please do not use `helpers.debug`",
      );
      logger.debug(format, { parameters });
    },
  } as unknown);

  return helpers;
}

export function makeWithPgClientFromPool(pgPool: Pool) {
  return async function withPgClientFromPool<T>(
    callback: (pgClient: PoolClient) => Promise<T>,
  ) {
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
