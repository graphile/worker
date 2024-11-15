import { Pool, PoolClient } from "pg";

import defer, { Deferred } from "./deferred";
import {
  AddJobFunction,
  AddJobsFunction,
  DbJob,
  DbJobSpec,
  EnhancedWithPgClient,
  Job,
  JobHelpers,
  PromiseOrDirect,
  WithPgClient,
} from "./interfaces";
import { CompiledSharedOptions } from "./lib";
import { Logger } from "./logger";
import { getQueueNames } from "./sql/getQueueNames";

export function makeAddJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
): AddJobFunction {
  const {
    escapedWorkerSchema,
    resolvedPreset: {
      worker: { useNodeTime },
    },
  } = compiledSharedOptions;
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

export function makeAddJobs(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
): AddJobsFunction {
  const {
    escapedWorkerSchema,
    resolvedPreset: {
      worker: { useNodeTime },
    },
  } = compiledSharedOptions;
  return (jobSpecs, jobKeyPreserveRunAt) =>
    withPgClient(async (pgClient) => {
      const NOW = useNodeTime ? new Date().toISOString() : undefined;
      const dbSpecs = jobSpecs.map(
        (spec): DbJobSpec => ({
          identifier: spec.identifier,
          payload: spec.payload,
          queue_name: spec.queueName,
          run_at: spec.runAt?.toISOString() ?? NOW,
          max_attempts: spec.maxAttempts,
          job_key: spec.jobKey,
          priority: spec.priority,
          flags: spec.flags,
        }),
      );
      const { rows: dbJobs } = await pgClient.query<DbJob>(
        `\
select *
from ${escapedWorkerSchema}.add_jobs(
  array(
    select json_populate_recordset(null::${escapedWorkerSchema}.job_spec, $1::json)
  ),
  $2::boolean
);`,
        [JSON.stringify(dbSpecs), jobKeyPreserveRunAt],
      );
      const jobs: Job[] = [];
      for (let i = 0, l = jobSpecs.length; i < l; i++) {
        const dbJob = dbJobs[i];
        const jobSpec = jobSpecs[i];
        jobs.push({
          ...dbJob,
          task_identifier: jobSpec.identifier,
        });
      }
      return jobs;
    });
}

const $$cache = Symbol("queueNameById");
const $$nextBatch = Symbol("pendingQueueIds");
function getQueueName(
  compiledSharedOptions: CompiledSharedOptions & {
    [$$cache]?: Record<number, string | Deferred<string> | undefined>;
    [$$nextBatch]?: number[];
  },
  withPgClient: EnhancedWithPgClient,
  queueId: number | null | undefined,
): PromiseOrDirect<string> | null {
  if (queueId == null) {
    return null;
  }

  let rawCache = compiledSharedOptions[$$cache];
  if (!rawCache) {
    rawCache = compiledSharedOptions[$$cache] = Object.create(null) as Record<
      number,
      string | Deferred<string> | undefined
    >;
  }

  // Appease TypeScript; this is not null
  const cache = rawCache;

  const existing = cache[queueId];
  if (existing !== undefined) {
    return existing;
  }

  let nextBatch = compiledSharedOptions[$$nextBatch];

  // Not currently requested; queue us (and don't queue us again)
  const promise = defer<string>();
  cache[queueId] = promise;

  if (nextBatch) {
    // Already scheduled; add us to the next batch
    nextBatch.push(queueId);
  } else {
    // Need to create the batch
    nextBatch = compiledSharedOptions[$$nextBatch] = [];
    nextBatch.push(queueId);

    // Appease TypeScript; this is not null
    const queueIds = nextBatch;

    // Schedule the batch to run
    setTimeout(() => {
      // Allow another batch to start processing
      compiledSharedOptions[$$nextBatch] = undefined;

      // Get this batches names
      getQueueNames(compiledSharedOptions, withPgClient, queueIds)
        .then(
          (names) => {
            //assert.equal(queueIds.length, names.length);
            for (let i = 0, l = queueIds.length; i < l; i++) {
              const queueId = queueIds[i];
              const name = names[i];
              const cached = cache[queueId];
              if (typeof cached === "object") {
                // It's a deferred; need to resolve/reject
                if (name != null) {
                  cached.resolve(name);
                  cache[queueId] = name;
                } else {
                  cached.reject(
                    new Error(`Queue with id '${queueId}' not found`),
                  );
                  // Try again
                  cache[queueId] = undefined;
                }
              } else {
                // It's already cached... but we got it again?!
                if (name != null) {
                  cache[queueId] = name;
                } else {
                  // Try again
                  cache[queueId] = undefined;
                }
              }
            }
          },
          (e) => {
            // An error occurred; reject all the deferreds but allow them to run again
            for (const queueId of queueIds) {
              (cache[queueId] as Deferred<string>).reject(e);
              // Retry next time
              cache[queueId] = undefined;
            }
          },
        )
        .catch((e) => {
          // This should never happen
          console.error(`Graphile Worker Internal Error`, e);
        });
    }, compiledSharedOptions.resolvedPreset.worker.getQueueNameBatchDelay ?? 50);
  }
  return promise;
}

export function makeJobHelpers(
  compiledSharedOptions: CompiledSharedOptions,
  job: Job,
  {
    withPgClient,
    abortSignal,
    logger: overrideLogger,
  }: {
    withPgClient: EnhancedWithPgClient;
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
    getQueueName(queueId = job.job_queue_id) {
      return getQueueName(compiledSharedOptions, withPgClient, queueId);
    },
    logger,
    withPgClient,
    query: (queryText, values) =>
      withPgClient((pgClient) => pgClient.query(queryText, values)),
    addJob: makeAddJob(compiledSharedOptions, withPgClient),
    addJobs: makeAddJobs(compiledSharedOptions, withPgClient),

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
