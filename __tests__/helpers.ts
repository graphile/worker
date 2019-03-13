import * as pg from "pg";
import { Job } from "../src/interfaces";

export async function withPgPool<T = any>(
  cb: (pool: pg.Pool) => Promise<T>
): Promise<T> {
  const pool = new pg.Pool({
    connectionString: "graphile_worker_test"
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
    updated_at: createdAt
  };
}
