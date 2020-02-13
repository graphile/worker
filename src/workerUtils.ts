import { WorkerUtilsOptions, TaskSpec, WorkerUtils } from "./interfaces";
import {
  makeWithPgClientFromPool,
  makeAddJob,
  makeCompleteJob,
  makeFailJob,
} from "./helpers";
import { defaultLogger } from "./logger";
import { withReleasers, assertPool } from "./runner";
import { migrate } from "./migrate";

/**
 * Construct (asynchronously) a new WorkerUtils instance.
 */
export async function makeWorkerUtils(
  options: WorkerUtilsOptions
): Promise<WorkerUtils> {
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
  const completeJob = makeCompleteJob(withPgClient);
  const failJob = makeFailJob(withPgClient);

  return {
    withPgClient,
    logger,
    release,
    addJob,
    completeJob,
    failJob,
    migrate: () => withPgClient(migrate),
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
