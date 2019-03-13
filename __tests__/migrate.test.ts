import { migrate } from "../src/migrate";
import { withPgClient } from "./helpers";

test("installs schema", () =>
  withPgClient(async pgClient => {
    // Assert DB is empty
    const {
      rows: [graphileWorkerNamespaceBeforeMigration]
    } = await pgClient.query(
      `select * from pg_catalog.pg_namespace where nspname = $1`,
      ["graphile_worker"]
    );
    expect(graphileWorkerNamespaceBeforeMigration).toBeFalsy();

    // Perform migration
    await migrate(pgClient);

    // Assert migrations table exists and has relevant entries
    const { rows: migrationRows } = await pgClient.query(
      `select * from graphile_worker.migrations`
    );
    expect(migrationRows).toHaveLength(1);
    const migration = migrationRows[0];
    expect(migration.id).toEqual(1);

    // Assert job schema files have been created (we're asserting no error is thrown)
    const { rows: jobsRows } = await pgClient.query(
      `select * from graphile_worker.jobs`
    );
    expect(jobsRows).toHaveLength(0);
  }));
