import { migrate } from "../src/migrate";
import {
  withPgClient,
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  GRAPHILE_WORKER_SCHEMA,
} from "./helpers";
import { WorkerSharedOptions } from "../src";

const options: WorkerSharedOptions = {};

test("migration installs schema; second migration does no harm", async () => {
  await withPgClient(async pgClient => {
    await pgClient.query(
      `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`
    );
  });
  // We need to use a fresh connection after dropping the schema because the SQL
  // functions' plans get cached using the stale OIDs.
  await withPgClient(async pgClient => {
    // Assert DB is empty
    const {
      rows: [graphileWorkerNamespaceBeforeMigration],
    } = await pgClient.query(
      `select * from pg_catalog.pg_namespace where nspname = $1`,
      [GRAPHILE_WORKER_SCHEMA]
    );
    expect(graphileWorkerNamespaceBeforeMigration).toBeFalsy();

    // Perform migration
    await migrate(options, pgClient);

    // Assert migrations table exists and has relevant entries
    const { rows: migrationRows } = await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.migrations`
    );
    expect(migrationRows).toHaveLength(4);
    const migration = migrationRows[0];
    expect(migration.id).toEqual(1);

    // Assert job schema files have been created (we're asserting no error is thrown)
    await pgClient.query(
      `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('assert_jobs_work')`
    );
    {
      const { rows: jobsRows } = await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`
      );
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }

    // Assert that re-migrating causes no issues
    await migrate(options, pgClient);
    await migrate(options, pgClient);
    await migrate(options, pgClient);
    {
      const { rows: jobsRows } = await pgClient.query(
        `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`
      );
      expect(jobsRows).toHaveLength(1);
      expect(jobsRows[0].task_identifier).toEqual("assert_jobs_work");
    }
  });
});
