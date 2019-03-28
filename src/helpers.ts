import { debugFactory } from "./debug";
import { WithPgClient, Job, Helpers, TaskOptions } from "./interfaces";
import { Pool, PoolClient } from "pg";

export function makeHelpers(
  job: Job,
  { withPgClient }: { withPgClient: WithPgClient }
): Helpers {
  return {
    job,
    debug: debugFactory(`${job.task_identifier}`),
    withPgClient,
    addJob(identifier: string, payload: any = {}, options: TaskOptions = {}) {
      return withPgClient(async pgClient => {
        const {
          rows
        } = await pgClient.query(
          `
          select * from graphile_worker.add_job(
            identifier => $1::text,
            payload => $2::json,
            queue_name => coalesce($3::text, public.gen_random_uuid()::text),
            run_at => coalesce($4::timestamptz, now()),
            max_attempts => coalesce($5::int, 25)
          );
          `,
          [
            identifier,
            JSON.stringify(payload),
            options.queueName || null,
            options.runAt ? options.runAt.toISOString() : null,
            options.maxAttempts || null
          ]
        );
        const job: Job = rows[0];
        return job;
      });
    }
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
