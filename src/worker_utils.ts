import { WorkerUtilsOptions, TaskSpec, WorkerUtilsHelpers } from "./interfaces";
import { makeWithPgClientFromPool, makeAddJob } from "./helpers";
import { migrate } from "./migrate";
import { defaultLogger } from "./logger";
import { withReleasers, assertPool } from "./runner";

async function makeWorkerUtilsHelpers(
  options: WorkerUtilsOptions
): Promise<WorkerUtilsHelpers> {
  const { logger: baseLogger = defaultLogger } = options;
  const logger = baseLogger.scope({
    label: "WorkerUtils",
  });

  const { pgPool, release } = await withReleasers(
    async (releasers, release) => ({
      pgPool: await assertPool(options, releasers, logger),
      release,
    })
  );

  const withPgClient = makeWithPgClientFromPool(pgPool);
  const addJob = makeAddJob(withPgClient);

  await withPgClient(client => migrate(client));

  return {
    withPgClient,
    logger,
    release,
    addJob,
  };
}

/**
 * Construct (asynchronously) a new WorkerUtils instance.
 */
export async function makeWorkerUtils(
  options: WorkerUtilsOptions
): Promise<WorkerUtils> {
  const helpers = await makeWorkerUtilsHelpers(options);
  return new PrivateWorkerUtils(helpers) as WorkerUtils;
}

/**
 * Utilities for working with Graphile Worker. Primarily useful for adding
 * jobs.
 */
class PrivateWorkerUtils implements WorkerUtilsHelpers {
  /**
   * Do not construct this class directly, use `await makeWorkerUtils(options)`
   */
  constructor(helpers: WorkerUtilsHelpers) {
    Object.assign(this, helpers);
  }

  /**
   * A Logger instance, scoped to label: 'WorkerUtils'
   */
  public logger: WorkerUtilsHelpers["logger"];

  /**
   * Grabs a PostgreSQL client from the pool, awaits your callback, then
   * releases the client back to the pool.
   */
  public withPgClient: WorkerUtilsHelpers["withPgClient"];

  /**
   * Adds a job into our queue.
   */
  public addJob: WorkerUtilsHelpers["addJob"];

  /**
   * Use this to release the WorkerUtils when you no longer need it.
   * Particularly useful in tests, or in short-running scripts.
   */
  public release: WorkerUtilsHelpers["release"];
}

export type WorkerUtils = InstanceType<typeof PrivateWorkerUtils>;

/**
 * This function can be used to quickly add a job; however if you need to call
 * this more than once in your process you should instead create a WorkerUtils
 * instance for efficiency and performance sake.
 */
export async function addJob(
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
