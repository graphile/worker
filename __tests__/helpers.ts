import * as pg from "pg";

export async function withPgPool<T = any>(cb: (pool: pg.Pool) => Promise<T>) {
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
) {
  return withPgPool(async pool => {
    const client = await pool.connect();
    try {
      return await cb(client);
    } finally {
      client.release();
    }
  });
}
