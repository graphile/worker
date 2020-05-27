import { PoolClient } from "pg";

import { readdir, readFile } from "./fs";
import { WorkerSharedOptions } from "./interfaces";
import { processSharedOptions } from "./lib";

async function installSchema(options: WorkerSharedOptions, client: PoolClient) {
  const { escapedWorkerSchema } = processSharedOptions(options);
  await client.query(`
    create extension if not exists pgcrypto with schema public;
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

  const {
    rows: [pgNamespace],
  } = await client.query(
    `select oid from pg_catalog.pg_namespace where nspname = $1;`,
    [workerSchema],
  );
  if (!pgNamespace) {
    await installSchema(options, client);
  }

  const {
    rows: [row],
  } = await client.query(
    `select id from ${escapedWorkerSchema}.migrations order by id desc limit 1;`,
  );
  if (row) {
    latestMigration = row.id;
  }
  const migrationFiles = (await readdir(`${__dirname}/../sql`))
    .filter((f) => f.match(/^[0-9]{6}\.sql$/))
    .sort();
  for (const migrationFile of migrationFiles) {
    const migrationNumber = parseInt(migrationFile.substr(0, 6), 10);
    if (latestMigration == null || migrationNumber > latestMigration) {
      await runMigration(options, client, migrationFile, migrationNumber);
    }
  }
}
