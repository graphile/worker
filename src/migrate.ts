import { PoolClient } from "pg";

import { migrations } from "./generated/sql";
import { WorkerSharedOptions } from "./interfaces";
import { processSharedOptions } from "./lib";

function checkPostgresVersion(versionString: string) {
  const version = parseInt(versionString, 10);

  if (version < 120000) {
    throw new Error(
      `This version of Graphile Worker requires PostgreSQL v12.0 or greater (detected \`server_version_num\` = ${versionString})`,
    );
  }
}

async function fetchAndCheckPostgresVersion(client: PoolClient) {
  const {
    rows: [row],
  } = await client.query(
    "select current_setting('server_version_num') as server_version_num",
  );
  checkPostgresVersion(row.server_version_num);
}

async function installSchema(options: WorkerSharedOptions, client: PoolClient) {
  const { escapedWorkerSchema } = processSharedOptions(options);

  await fetchAndCheckPostgresVersion(client);

  await client.query(`
    create schema ${escapedWorkerSchema};
    create table ${escapedWorkerSchema}.migrations(
      id int primary key,
      ts timestamptz default now() not null
    );
  `);
}

async function runMigration(
  options: WorkerSharedOptions,
  client: PoolClient,
  migrationFile: keyof typeof migrations,
  migrationNumber: number,
) {
  const { escapedWorkerSchema } = processSharedOptions(options);
  const rawText = migrations[migrationFile];
  const text = rawText.replace(
    /:GRAPHILE_WORKER_SCHEMA\b/g,
    escapedWorkerSchema,
  );
  await client.query("begin");
  try {
    await client.query({
      text,
    });
    await client.query({
      text: `insert into ${escapedWorkerSchema}.migrations (id) values ($1)`,
      values: [migrationNumber],
    });
    await client.query("select pg_notify($1, $2)", [
      "jobs:migrate",
      JSON.stringify({ migrationNumber }),
    ]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

export async function migrate(
  options: WorkerSharedOptions,
  client: PoolClient,
) {
  const { escapedWorkerSchema } = processSharedOptions(options);
  let latestMigration: number | null = null;
  try {
    const {
      rows: [row],
    } = await client.query(
      `select current_setting('server_version_num') as server_version_num,
      (select id from ${escapedWorkerSchema}.migrations order by id desc limit 1) as id;`,
    );

    latestMigration = row.id;
    checkPostgresVersion(row.server_version_num);
  } catch (e) {
    if (e.code === "42P01") {
      await installSchema(options, client);
    } else {
      throw e;
    }
  }

  const migrationFiles = Object.keys(migrations) as (keyof typeof migrations)[];
  let highestMigration = 0;
  for (const migrationFile of migrationFiles) {
    const migrationNumber = parseInt(migrationFile.slice(0, 6), 10);
    if (migrationNumber > highestMigration) {
      highestMigration = migrationNumber;
    }
    if (latestMigration == null || migrationNumber > latestMigration) {
      await runMigration(options, client, migrationFile, migrationNumber);
    }
  }
  if (latestMigration && highestMigration < latestMigration) {
    process.exitCode = 18; // It's too late to run this; the DB has moved on.
    throw new Error(
      `Database is using Graphile Worker schema revision ${latestMigration}, but the currently running worker only supports up to revision ${highestMigration}. Please ensure all versions of Graphile Worker you're running are compatible.`,
    );
  }
}
