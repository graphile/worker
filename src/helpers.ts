import { debugFactory } from "./debug";
import { WithPgClient, Job, Helpers } from "./interfaces";
import { Pool, PoolClient } from "pg";

export function makeHelpers(
  job: Job,
  { withPgClient }: { withPgClient: WithPgClient }
): Helpers {
  return {
    job,
    debug: debugFactory(`${job.task_identifier}`),
    withPgClient
    // TODO: add an API for giving workers more helpers
  };
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
