import { PoolClient } from "pg";

import { migrations } from "./generated/sql";
import { WorkerSharedOptions, Writeable } from "./interfaces";
import {
  BREAKING_MIGRATIONS,
  coerceError,
  CompiledSharedOptions,
  sleep,
} from "./lib";

function checkPostgresVersion(versionString: string) {
  const postgresVersion = parseInt(versionString, 10);

  if (postgresVersion < 120000) {
    throw new Error(
      `This version of Graphile Worker requires PostgreSQL v12.0 or greater (detected \`server_version_num\` = ${versionString})`,
    );
  }
  return postgresVersion;
}

async function fetchAndCheckPostgresVersion(client: PoolClient) {
  const {
    rows: [row],
  } = await client.query(
    "select current_setting('server_version_num') as server_version_num",
  );
  return checkPostgresVersion(row.server_version_num);
}

/** @internal */
export async function installSchema(
  compiledSharedOptions: CompiledSharedOptions<WorkerSharedOptions>,
  event: GraphileWorker.MigrateEvent,
) {
  const { hooks, escapedWorkerSchema, middleware } = compiledSharedOptions;

  (event as Writeable<GraphileWorker.MigrateEvent>).postgresVersion =
    await fetchAndCheckPostgresVersion(event.client);
  await middleware.run("bootstrap", event, async (event) => {
    await hooks.process("prebootstrap", event);
    // Change to this query should be reflected in website/docs/schema.md
    await event.client.query(`\
create schema if not exists ${escapedWorkerSchema};
create table if not exists ${escapedWorkerSchema}.migrations(
  id int primary key,
  ts timestamptz default now() not null
);
alter table ${escapedWorkerSchema}.migrations add column if not exists breaking boolean not null default false;
`);
    await event.client.query(
      `update ${escapedWorkerSchema}.migrations set breaking = true where id = any($1::int[])`,
      [BREAKING_MIGRATIONS],
    );
    await hooks.process("postbootstrap", event);
  });
}

/** @internal */
export async function runMigration(
  compiledSharedOptions: CompiledSharedOptions<WorkerSharedOptions>,
  event: GraphileWorker.MigrateEvent,
  migrationFile: keyof typeof migrations,
  migrationNumber: number,
) {
  const { escapedWorkerSchema, logger, hooks } = compiledSharedOptions;
  const rawText = migrations[migrationFile];
  const text = rawText.replace(
    /:GRAPHILE_WORKER_SCHEMA\b/g,
    escapedWorkerSchema,
  );
  const breaking = BREAKING_MIGRATIONS.includes(migrationNumber);
  logger.debug(
    `Running ${
      breaking ? "breaking" : "backwards-compatible"
    } migration ${migrationFile}`,
  );
  let migrationInsertComplete = false;
  await event.client.query("begin");
  try {
    // Must come first so we can detect concurrent migration
    await event.client.query({
      text: `insert into ${escapedWorkerSchema}.migrations (id, breaking) values ($1, $2)`,
      values: [migrationNumber, breaking],
    });
    migrationInsertComplete = true;
    await event.client.query({
      text,
    });
    await event.client.query("select pg_notify($1, $2)", [
      "worker:migrate",
      JSON.stringify({ migrationNumber, breaking }),
    ]);
    await event.client.query("commit");
  } catch (rawError) {
    const error = coerceError(rawError);
    await event.client.query("rollback");
    await hooks.process("migrationError", { ...event, error });
    if (
      !migrationInsertComplete &&
      CLASH_CODES.includes(error.code as string)
    ) {
      // Someone else did this migration! Success!
      logger.debug(
        `Some other worker has performed migration ${migrationFile}; continuing.`,
      );
      return;
    }
    if (error.code === "22012" && migrationNumber === 11) {
      throw new Error(
        `There are locked jobs present; migration 11 cannot complete. Please ensure all workers are shut down cleanly and all locked jobs and queues are unlocked before attempting this migration. To achieve this with minimal downtime, please consider using Worker Pro: https://worker.graphile.org/docs/pro/migration`,
      );
    }
    throw error;
  }
}

/** @internal */
export async function migrate(
  compiledSharedOptions: CompiledSharedOptions<WorkerSharedOptions>,
  client: PoolClient,
) {
  const { escapedWorkerSchema, hooks, logger, middleware } =
    compiledSharedOptions;
  let latestMigration: number | null = null;
  let latestBreakingMigration: number | null = null;
  const event = {
    ctx: compiledSharedOptions,
    client,
    postgresVersion: 0,
    scratchpad: Object.create(null),
  };
  for (let attempts = 0; attempts < 2; attempts++) {
    try {
      const {
        rows: [row],
      } = await event.client.query(
        `\
select current_setting('server_version_num') as server_version_num,
(select id from ${escapedWorkerSchema}.migrations order by id desc limit 1) as id,
(select id from ${escapedWorkerSchema}.migrations where breaking is true order by id desc limit 1) as biggest_breaking_id;
`,
      );

      latestMigration = row.id;
      latestBreakingMigration = row.biggest_breaking_id;
      event.postgresVersion = checkPostgresVersion(row.server_version_num);
      break;
    } catch (rawE) {
      const e = coerceError(rawE);
      if (attempts === 0 && NX_CODES.includes(e.code as string)) {
        try {
          await installSchema(compiledSharedOptions, event);
          break;
        } catch (rawE2) {
          const e2 = coerceError(rawE2);
          if (CLASH_CODES.includes(e2.code as string)) {
            // Another instance installed this concurrently? Go around again.
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }
    // Need to wait at least a couple hundred ms for the connection to catch
    // up, then a random extra amount to avoid more conflicts
    await sleep(400 + Math.random() * 200);
  }

  await middleware.run("migrate", event, async (event) => {
    await hooks.process("premigrate", event);

    const migrationFiles = Object.keys(
      migrations,
    ) as (keyof typeof migrations)[];
    let highestMigration = 0;
    let migrated = false;
    for (const migrationFile of migrationFiles) {
      const migrationNumber = parseInt(migrationFile.slice(0, 6), 10);
      if (migrationNumber > highestMigration) {
        highestMigration = migrationNumber;
      }
      if (latestMigration == null || migrationNumber > latestMigration) {
        migrated = true;
        await runMigration(
          compiledSharedOptions,
          event,
          migrationFile,
          migrationNumber,
        );
      }
    }

    if (migrated) {
      logger.debug(`Migrations complete`);
    }

    if (latestBreakingMigration && highestMigration < latestBreakingMigration) {
      process.exitCode = 57;
      throw new Error(
        `Database is using Graphile Worker schema revision ${latestMigration} which includes breaking migration ${latestBreakingMigration}, but the currently running worker only supports up to revision ${highestMigration}. It would be unsafe to continue; please ensure all versions of Graphile Worker are compatible.`,
      );
    } else if (latestMigration && highestMigration < latestMigration) {
      logger.warn(
        `Database is using Graphile Worker schema revision ${latestMigration}, but the currently running worker only supports up to revision ${highestMigration} which may or may not be compatible. Please ensure all versions of Graphile Worker you're running are compatible, or use Worker Pro which will perform this check for you. Attempting to continue regardless.`,
      );
    }
    await hooks.process("postmigrate", event);
  });
}

/** Doesn't exist */
const NX_CODES = ["42P01", "42703"];
/** Someone else created */
const CLASH_CODES = ["23505", "42P06", "42P07", "42710"];
