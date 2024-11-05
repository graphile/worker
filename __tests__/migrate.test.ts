import { PoolClient } from "pg";

import { WorkerSharedOptions } from "../src";
import { migrations } from "../src/generated/sql";
import { processSharedOptions } from "../src/lib";
import { installSchema, migrate, runMigration } from "../src/migrate";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  getJobs,
  GRAPHILE_WORKER_SCHEMA,
  sleep,
  withPgClient,
  withPgPool,
} from "./helpers";

const options: WorkerSharedOptions = {};

test("migration installs schema; second migration does no harm", async () => {
  await withPgClient(async (pgClient) => {
    await pgClient.query(
      `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
    );
  });
  // We need to use a fresh connection after dropping the schema because the SQL
  // functions' plans get cached using the stale OIDs.
  await withPgClient(async (pgClient) => {
    // Assert DB is empty
    const {
      rows: [graphileWorkerNamespaceBeforeMigration],
    } = await pgClient.query(
      `select * from pg_catalog.pg_namespace where nspname = $1`,
      [GRAPHILE_WORKER_SCHEMA],
    );
    expect(graphileWorkerNamespaceBeforeMigration).toBeFalsy();

    // Perform migration
    const compiledSharedOptions = processSharedOptions(options);
    await migrate(compiledSharedOptions, pgClient);

    // Assert migrations table exists and has relevant entries
    const { rows: migrationRows } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations`,
    );
    expect(migrationRows).toHaveLength(18);
    const migration = migrationRows[0];
    expect(migration.id).toEqual(1);

    // Assert job schema files have been created (we're asserting no error is thrown)
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('assert_jobs_work')`,
    );
    {
      const jobsRows = await getJobs(pgClient);
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }

    // Assert that re-migrating causes no issues
    await migrate(compiledSharedOptions, pgClient);
    await migrate(compiledSharedOptions, pgClient);
    await migrate(compiledSharedOptions, pgClient);
    {
      const jobsRows = await getJobs(pgClient);
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }
  });
});

test("multiple concurrent installs of the schema is fine", async () => {
  const compiledSharedOptions = processSharedOptions(options);
  await withPgClient(async (pgClient) => {
    await pgClient.query(
      `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
    );
  });
  await withPgPool(async (pool) => {
    const COUNT = 20;
    const clients: PoolClient[] = [];
    for (let i = 0; i < COUNT; i++) {
      clients.push(await pool.connect());
    }
    const promises: Promise<void>[] = [];
    for (let i = 0; i < COUNT; i++) {
      promises.push(
        (async () => {
          // Perform migration
          await migrate(compiledSharedOptions, clients[i]);
        })(),
      );
    }
    await Promise.all(promises);
    await Promise.all(clients.map((c) => c.release()));
  });
  await withPgClient(async (pgClient) => {
    // Assert migrations table exists and has relevant entries
    const { rows: migrationRows } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations`,
    );
    expect(migrationRows).toHaveLength(18);
    const migration = migrationRows[0];
    expect(migration.id).toEqual(1);

    // Assert job schema files have been created (we're asserting no error is thrown)
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('assert_jobs_work')`,
    );
    {
      const jobsRows = await getJobs(pgClient);
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }
  });
});

test("migration can take over from pre-existing migrations table", async () => {
  await withPgClient(async (pgClient) => {
    await pgClient.query(
      `\
drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;
create schema if not exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA};
create table if not exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations(
  id int primary key,
  ts timestamptz default now() not null
);
insert into ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations (id) values (1);
`,
    );
    await pgClient.query(
      migrations["000001.sql"].replace(
        /:GRAPHILE_WORKER_SCHEMA/g,
        ESCAPED_GRAPHILE_WORKER_SCHEMA,
      ),
    );
  });
  // We need to use a fresh connection after dropping the schema because the SQL
  // functions' plans get cached using the stale OIDs.
  await withPgClient(async (pgClient) => {
    const compiledSharedOptions = processSharedOptions(options);

    // Perform migration
    await migrate(compiledSharedOptions, pgClient);

    // Assert migrations table exists and has relevant entries
    const { rows: migrationRows } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations`,
    );
    expect(migrationRows.length).toBeGreaterThanOrEqual(18);
    const migration2 = migrationRows[1];
    expect(migration2.id).toEqual(2);
    expect(migration2.breaking).toEqual(false);
    const migration11 = migrationRows[10];
    expect(migration11.id).toEqual(11);
    expect(migration11.breaking).toEqual(true);

    // Assert job schema files have been created (we're asserting no error is thrown)
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('assert_jobs_work')`,
    );
    {
      const jobsRows = await getJobs(pgClient);
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }

    // Assert that re-migrating causes no issues
    await migrate(compiledSharedOptions, pgClient);
    await migrate(compiledSharedOptions, pgClient);
    await migrate(compiledSharedOptions, pgClient);
    {
      const jobsRows = await getJobs(pgClient);
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }
  });
});

test("aborts if database is more up to date than current worker", async () => {
  await withPgClient(async (pgClient) => {
    await pgClient.query(
      `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
    );
  });
  // We need to use a fresh connection after dropping the schema because the SQL
  // functions' plans get cached using the stale OIDs.
  await withPgClient(async (pgClient) => {
    // Assert DB is empty
    const {
      rows: [graphileWorkerNamespaceBeforeMigration],
    } = await pgClient.query(
      `select * from pg_catalog.pg_namespace where nspname = $1`,
      [GRAPHILE_WORKER_SCHEMA],
    );
    expect(graphileWorkerNamespaceBeforeMigration).toBeFalsy();

    const compiledSharedOptions = processSharedOptions(options);

    // Perform migration
    await migrate(compiledSharedOptions, pgClient);

    // Insert a more up to date migration
    await pgClient.query(
      `insert into ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations (id, ts, breaking) values (999999, '2023-10-19T10:31:00Z', true);`,
    );

    await expect(
      migrate(compiledSharedOptions, pgClient),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Database is using Graphile Worker schema revision 999999 which includes breaking migration 999999, but the currently running worker only supports up to revision 18. It would be unsafe to continue; please ensure all versions of Graphile Worker are compatible."`,
    );
  });
});

test("throws helpful error message in migration 11", async () => {
  await withPgClient(async (pgClient) => {
    await pgClient.query(
      `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
    );
  });
  // We need to use a fresh connection after dropping the schema because the SQL
  // functions' plans get cached using the stale OIDs.
  await withPgClient(async (pgClient) => {
    // Assert DB is empty
    const {
      rows: [graphileWorkerNamespaceBeforeMigration],
    } = await pgClient.query(
      `select * from pg_catalog.pg_namespace where nspname = $1`,
      [GRAPHILE_WORKER_SCHEMA],
    );
    expect(graphileWorkerNamespaceBeforeMigration).toBeFalsy();

    const compiledSharedOptions = processSharedOptions(options);

    // Manually run the first 10 migrations
    const event = {
      client: pgClient,
      postgresVersion: 120000, // TODO: use the actual postgres version
      scratchpad: Object.create(null),
    };
    await installSchema(compiledSharedOptions, event);
    const migrationFiles = Object.keys(
      migrations,
    ) as (keyof typeof migrations)[];
    for (const migrationFile of migrationFiles) {
      const migrationNumber = parseInt(migrationFile.slice(0, 6), 10);
      if (migrationNumber > 10) {
        break;
      }
      await runMigration(
        compiledSharedOptions,
        event,
        migrationFile,
        migrationNumber,
      );
    }

    // Lock a job
    await pgClient.query(
      `select ${compiledSharedOptions.escapedWorkerSchema}.add_job('lock_me', '{}');`,
    );
    await pgClient.query(
      `update ${compiledSharedOptions.escapedWorkerSchema}.jobs set locked_at = now(), locked_by = 'test_runner';`,
    );

    // Perform migration
    const promise = migrate(compiledSharedOptions, pgClient);

    await expect(promise).rejects.toThrowErrorMatchingInlineSnapshot(
      `"There are locked jobs present; migration 11 cannot complete. Please ensure all workers are shut down cleanly and all locked jobs and queues are unlocked before attempting this migration. To achieve this with minimal downtime, please consider using Worker Pro: https://worker.graphile.org/docs/pro/migration"`,
    );
  });
});

afterAll(() => {
  process.exitCode = 0;
});
