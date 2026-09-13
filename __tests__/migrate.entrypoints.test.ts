import { makeWorkerUtils, run, runMigrations, runOnce } from "../src/index.ts";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  GRAPHILE_WORKER_SCHEMA,
  withPgClient,
} from "./helpers.ts";

async function dropSchema() {
  await withPgClient(async (pgClient) => {
    await pgClient.query(
      `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
    );
  });
}

async function expectSchemaExists(exists: boolean) {
  await withPgClient(async (pgClient) => {
    const { rows } = await pgClient.query(
      `select * from pg_catalog.pg_namespace where nspname = $1`,
      [GRAPHILE_WORKER_SCHEMA],
    );
    expect(rows).toHaveLength(exists ? 1 : 0);
  });
}

test("makeWorkerUtils() does not migrate", async () => {
  await dropSchema();
  await withPgClient(async (_pgClient, { TEST_CONNECTION_STRING }) => {
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    try {
      await expectSchemaExists(false);
    } finally {
      await utils.release();
    }
  });
});

test("utils.migrate() migrates", async () => {
  await dropSchema();
  await withPgClient(async (_pgClient, { TEST_CONNECTION_STRING }) => {
    const utils = await makeWorkerUtils({
      connectionString: TEST_CONNECTION_STRING,
    });
    try {
      await expectSchemaExists(false);
      await utils.migrate();
    } finally {
      await utils.release();
    }
  });
  await expectSchemaExists(true);
});

test("runOnce() migrates", async () => {
  await dropSchema();
  await withPgClient(async (_pgClient, { TEST_CONNECTION_STRING }) => {
    await runOnce({
      connectionString: TEST_CONNECTION_STRING,
      taskList: {},
    });
  });
  await expectSchemaExists(true);
});

test("run() migrates", async () => {
  await dropSchema();
  await withPgClient(async (_pgClient, { TEST_CONNECTION_STRING }) => {
    const runner = await run({
      connectionString: TEST_CONNECTION_STRING,
      taskList: {},
    });
    await runner.stop();
  });
  await expectSchemaExists(true);
});

test("runMigrations() migrates", async () => {
  await dropSchema();
  await withPgClient(async (_pgClient, { TEST_CONNECTION_STRING }) => {
    await runMigrations({
      connectionString: TEST_CONNECTION_STRING,
    });
  });
  await expectSchemaExists(true);
});
