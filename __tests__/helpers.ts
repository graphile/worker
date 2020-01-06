import * as pg from "pg";
import { Job } from "../src/interfaces";
import { migrate } from "../src/migrate";

process.env.GRAPHILE_WORKER_DEBUG = "1";

export const TEST_CONNECTION_STRING =
  process.env.TEST_CONNECTION_STRING || "graphile_worker_test";

export async function withPgPool<T = any>(
  cb: (pool: pg.Pool) => Promise<T>
): Promise<T> {
  const pool = new pg.Pool({
    connectionString: TEST_CONNECTION_STRING,
  });
  try {
    return await cb(pool);
  } finally {
    pool.end();
  }
}

export async function withPgClient<T = any>(
  cb: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  return withPgPool(async pool => {
    const client = await pool.connect();
    try {
      return await cb(client);
    } finally {
      client.release();
    }
  });
}

export async function withTransaction<T = any>(
  cb: (client: pg.PoolClient) => Promise<T>,
  closeCommand = "rollback"
): Promise<T> {
  return withPgClient(async client => {
    await client.query("begin");
    try {
      return await cb(client);
    } finally {
      await client.query(closeCommand);
    }
  });
}

function isPoolClient(o: any): o is pg.PoolClient {
  return o && typeof o.release === "function";
}

export async function reset(pgPoolOrClient: pg.Pool | pg.PoolClient) {
  await pgPoolOrClient.query("drop schema if exists graphile_worker cascade;");
  if (isPoolClient(pgPoolOrClient)) {
    await migrate(pgPoolOrClient);
  } else {
    const client = await pgPoolOrClient.connect();
    try {
      await migrate(client);
    } finally {
      await client.release();
    }
  }
}

export async function jobCount(
  pgPoolOrClient: pg.Pool | pg.PoolClient
): Promise<number> {
  const {
    rows: [row],
  } = await pgPoolOrClient.query(
    "select count(*)::int from graphile_worker.jobs"
  );
  return row ? row.count || 0 : 0;
}

export function makeMockJob(taskIdentifier: string): Job {
  const createdAt = new Date(Date.now() - 12345678);
  return {
    id: Math.floor(Math.random() * 4294967296),
    queue_name: "3ED1F485-5D29-4C53-9F47-40925AA81D3B",
    task_identifier: taskIdentifier,
    payload: {},
    priority: 0,
    run_at: new Date(Date.now() - Math.random() * 2000),
    attempts: 0,
    last_error: null,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export const sleep = (ms: number) =>
  new Promise(resolve => setTimeout(resolve, ms));

export async function sleepUntil(condition: () => boolean, maxDuration = 2000) {
  const start = Date.now();
  // Wait up to a second for the job to be executed
  while (!condition() && Date.now() - start < maxDuration) {
    await sleep(2);
  }
  if (!condition()) {
    throw new Error(
      `Slept for ${Date.now() - start}ms but condition never passed`
    );
  }
}
