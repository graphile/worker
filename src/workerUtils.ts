import { WorkerUtilsOptions, TaskSpec, WorkerUtils, Job } from "./interfaces";
import { makeWithPgClientFromPool, makeAddJob } from "./helpers";
import { withReleasers, assertPool } from "./runner";
import { migrate } from "./migrate";
import { processSharedOptions } from "./lib";

/**
 * Construct (asynchronously) a new WorkerUtils instance.
 */
export async function makeWorkerUtils(
  options: WorkerUtilsOptions
): Promise<WorkerUtils> {
  const { logger, escapedWorkerSchema } = processSharedOptions(options, {
    scope: {
      label: "WorkerUtils",
    },
  });

  const { pgPool, release } = await withReleasers(
    async (releasers, release) => ({
      pgPool: await assertPool(options, releasers, logger),
      release,
    })
  );

  const withPgClient = makeWithPgClientFromPool(pgPool);
  const addJob = makeAddJob(withPgClient, options);

  return {
    withPgClient,
    logger,
    release,
    addJob,
    migrate: () => withPgClient(pgClient => migrate(pgClient, options)),

    async completeJobs(ids) {
      const { rows } = await withPgClient(client =>
        client.query<Job>(
          `select * from ${escapedWorkerSchema}.complete_jobs($1)`,
          [ids]
        )
      );
      return rows;
    },

    async permanentlyFailJobs(ids, reason) {
      const { rows } = await withPgClient(client =>
        client.query<Job>(
          `select * from ${escapedWorkerSchema}.permanently_fail_jobs($1, $2)`,
          [ids, reason || null]
        )
      );
      return rows;
    },

    async rescheduleJobs(ids, options) {
      const { rows } = await withPgClient(client =>
        client.query<Job>(
          `select * from ${escapedWorkerSchema}.reschedule_jobs(
            $1,
            run_at := $2,
            priority := $3,
            attempts := $4,
            max_attempts := $5
          )`,
          [
            ids,
            options.runAt || null,
            options.priority || null,
            options.attempts || null,
            options.maxAttempts || null,
          ]
        )
      );
      return rows;
    },
  };
}

/**
 * This function can be used to quickly add a job; however if you need to call
 * this more than once in your process you should instead create a WorkerUtils
 * instance for efficiency and performance sake.
 */
export async function quickAddJob(
  options: WorkerUtilsOptions,
  identifier: string,
  payload: any = {},
  spec: TaskSpec = {}
) {
  const utils = await makeWorkerUtils(options);
  try {
    return await utils.addJob(identifier, payload, spec);
  } finally {
    await utils.release();
  }
}
