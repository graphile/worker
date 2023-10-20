import { DbJob, TaskSpec, WorkerUtils, WorkerUtilsOptions } from "./interfaces";
import { getUtilsAndReleasersFromOptions } from "./lib";
import { migrate } from "./migrate";

/**
 * Construct (asynchronously) a new WorkerUtils instance.
 */
export async function makeWorkerUtils(
  options: WorkerUtilsOptions,
): Promise<WorkerUtils> {
  const { logger, escapedWorkerSchema, release, withPgClient, addJob } =
    await getUtilsAndReleasersFromOptions(options, {
      scope: {
        label: "WorkerUtils",
      },
    });

  return {
    withPgClient,
    logger,
    release,
    addJob,
    migrate: () => withPgClient((pgClient) => migrate(options, pgClient)),

    async completeJobs(ids) {
      const { rows } = await withPgClient((client) =>
        client.query<DbJob>(
          `select * from ${escapedWorkerSchema}.complete_jobs($1::bigint[])`,
          [ids],
        ),
      );
      return rows;
    },

    async permanentlyFailJobs(ids, reason) {
      const { rows } = await withPgClient((client) =>
        client.query<DbJob>(
          `select * from ${escapedWorkerSchema}.permanently_fail_jobs($1::bigint[], $2::text)`,
          [ids, reason || null],
        ),
      );
      return rows;
    },

    async rescheduleJobs(ids, options) {
      const { rows } = await withPgClient((client) =>
        client.query<DbJob>(
          `select * from ${escapedWorkerSchema}.reschedule_jobs(
            $1::bigint[],
            run_at := $2::timestamptz,
            priority := $3::int,
            attempts := $4::int,
            max_attempts := $5::int
          )`,
          [
            ids,
            options.runAt || null,
            options.priority || null,
            options.attempts || null,
            options.maxAttempts || null,
          ],
        ),
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
export async function quickAddJob<
  TIdentifier extends keyof GraphileWorker.Tasks | (string & {}) = string,
>(
  options: WorkerUtilsOptions,
  identifier: TIdentifier,
  payload?: TIdentifier extends keyof GraphileWorker.Tasks
    ? GraphileWorker.Tasks[TIdentifier]
    : unknown,
  spec: TaskSpec = {},
) {
  const utils = await makeWorkerUtils(options);
  try {
    return await utils.addJob(identifier, payload, spec);
  } finally {
    await utils.release();
  }
}
