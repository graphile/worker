import {
  WorkerUtilsOptions,
  TaskOptions,
  WorkerUtilsHelpers,
} from "./interfaces";
import { makeWithPgClientFromPool, makeAddJob } from "./helpers";
import { migrate } from "./migrate";
import { defaultLogger } from "./logger";
import { withReleasers, assertPool } from "./runner";

const processWorkerUtilsOptions = async (
  options: WorkerUtilsOptions
): Promise<WorkerUtilsHelpers> => {
  const { logger = defaultLogger } = options;
  return withReleasers(async (releasers, release) => {
    const pgPool = await assertPool(options, releasers, logger);
    const withPgClient = makeWithPgClientFromPool(pgPool);

    await withPgClient(client => migrate(client));

    return { withPgClient, logger, release, addJob: makeAddJob(withPgClient) };
  });
};

/**
 * Because our class has an asynchronous startup, we add placeholder methods
 * which, if called before the class is ready, will wait for the class to be
 * ready and will then call their own replacements.
 */
function waitUntilReady(propertyName: string) {
  return async function(this: WorkerUtils, ...args: any[]): Promise<any> {
    // We're not ready; wait until we are
    await this.readyPromise;

    // Once ready; we have been replaced, so call our replacement:
    return this[propertyName](...args);
  };
}

/**
 * Utilities for working with Graphile Worker; currently only contains the
 * ability to add jobs.
 */
export class WorkerUtils {
  protected readyPromise: Promise<void>;

  constructor(options: WorkerUtilsOptions) {
    this.readyPromise = processWorkerUtilsOptions(options).then(
      ({ addJob, release }) => {
        // Replace our placeholder methods with the real ones:
        this.addJob = addJob;
        this.end = release;
      }
    );
  }

  /**
   * Adds a job into our queue.
   */
  public addJob: ReturnType<typeof makeAddJob> = waitUntilReady("addJob");

  /**
   * Use this to release the WorkerUtils when you no longer need it.
   * Particularly useful in tests, or in short-running scripts.
   */
  public end: () => Promise<void> = waitUntilReady("end");
}

/**
 * This function can be used to quickly add a job; however if you need to call
 * this more than once in your process you should instead create a WorkerUtils
 * instance for efficiency and performance sake.
 */
export async function addJob(
  config: WorkerUtilsOptions,
  identifier: string,
  payload: any = {},
  options: TaskOptions = {}
) {
  const utils = new WorkerUtils(config);
  try {
    return await utils.addJob(identifier, payload, options);
  } finally {
    await utils.end();
  }
}
