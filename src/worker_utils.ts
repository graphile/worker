import { Pool, PoolClient } from "pg";
import { WorkerUtilsOptions, TaskOptions, Job } from "./interfaces";
import { makeWithPgClientFromPool, makeAddJob } from "./helpers";
import { migrate } from "./migrate";
import { defaultLogger } from "./logger";
import { withReleasers, assertPool } from "./runner";

const processPublisherOptions = async (options: WorkerUtilsOptions) => {
  const { logger = defaultLogger } = options;
  return withReleasers(async (releasers, release) => {
    const pgPool: Pool = await assertPool(options, releasers, logger);

    const withPgClient = makeWithPgClientFromPool(pgPool);

    // Migrate
    await withPgClient(client => migrate(client));

    return { pgPool, withPgClient, release };
  });
};

export class WorkerUtils {
  private dbTools: Promise<{
    withPgClient: <T>(
      callback: (pgClient: PoolClient) => Promise<T>
    ) => Promise<T>;
    pgPool: Pool;
    release: Release;
  }>;

  constructor(options: WorkerUtilsOptions) {
    this.dbTools = processPublisherOptions(options);
  }

  public async addJob(
    identifier: string,
    payload: any = {},
    options: TaskOptions = {}
  ): Promise<Job> {
    const { withPgClient } = await this.dbTools;
    const addJob = makeAddJob(withPgClient);
    return addJob(identifier, payload, options);
  }

  async end(): Promise<void> {
    const { pgPool } = await this.dbTools;
    (await this.dbTools).release();
  }
}

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
    utils.end();
  }
}
