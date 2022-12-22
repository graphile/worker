import { PoolClient } from "pg";

import { readdir, readFile } from "./fs";
import { WorkerSharedOptions } from "./interfaces";
import { processSharedOptions } from "./lib";

function checkPostgresVersion(versionString: string) {
  const version = parseFloat(versionString);

  if (version < 12.0) {
    throw new Error(
      `Postgres version ${versionString} detected, 12.0 or greater required!`,
    );
  }
}

async function fetchAndCheckPostgresVersion(client: PoolClient) {
  const {
    rows: [row],
  } = await client.query(
    "select current_setting('server_version') as server_version",
  );
  checkPostgresVersion(row.server_version);
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
  migrationFile: string,
  migrationNumber: number,
) {
  const { escapedWorkerSchema } = processSharedOptions(options);
  const rawText = await readFile(
    `${__dirname}/../sql/${migrationFile}`,
    "utf8",
  );
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
      `select current_setting('server_version') as server_version,
      (select id from ${escapedWorkerSchema}.migrations order by id desc limit 1);`,
    );

    latestMigration = row.id;
    checkPostgresVersion(row.server_version);
  } catch (e) {
    if (e.code === "42P01") {
      await installSchema(options, client);
    } else {
      throw e;
    }
  }

  const migrationFiles = (await readdir(`${__dirname}/../sql`))
    .filter((f) => f.match(/^[0-9]{6}\.sql$/))
    .sort();
  for (const migrationFile of migrationFiles) {
    const migrationNumber = parseInt(migrationFile.slice(0, 6), 10);
    if (latestMigration == null || migrationNumber > latestMigration) {
      await runMigration(options, client, migrationFile, migrationNumber);
    }
  }
}
