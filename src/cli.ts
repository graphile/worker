#!/usr/bin/env node
import { Pool, PoolClient } from "pg";
import { migrate } from "./migrate";
import getTasks from "./getTasks";
import { start, runAllJobs } from "./main";
import * as yargs from "yargs";

const argv = yargs
  .option("connection", {
    description:
      "Database connection string, defaults to the 'DATABASE_URL' envvar",
    alias: "c"
  })
  .string("connection")
  .option("once", {
    description: "Run until there are no runnable jobs left, then exit",
    alias: "1",
    default: false
  })
  .boolean("once")
  .option("watch", {
    description:
      "[EXPERIMENTAL] Watch task files for changes, automatically reloading the task code without restarting worker",
    alias: "w",
    default: false
  })
  .boolean("watch")
  .option("jobs", {
    description: "number of jobs to run concurrently",
    alias: "j",
    default: 1
  })
  .number("jobs").argv;

const isInteger = (n: number): boolean => {
  return isFinite(n) && Math.round(n) === n;
};

const DATABASE_URL = argv.connection || process.env.DATABASE_URL || undefined;
const ONCE = argv.once;
const WATCH = argv.watch;
const JOBS = isInteger(argv.jobs) ? argv.jobs : 1;

if (WATCH && ONCE) {
  throw new Error("Cannot specify both --watch and --once");
}

async function withPgClient<T = any>(
  pgPool: Pool,
  cb: (pgClient: PoolClient) => Promise<T>
): Promise<T> {
  const pgClient = await pgPool.connect();
  try {
    return await cb(pgClient);
  } finally {
    pgClient.release();
  }
}

async function main() {
  if (!DATABASE_URL) {
    throw new Error(
      "Please use `--connection` flag or set `DATABASE_URL` envvar to indicate the PostgreSQL connection string."
    );
  }
  const watchedTasks = await getTasks(`${process.cwd()}/tasks`, WATCH);

  const pgPool = new Pool({
    connectionString: DATABASE_URL
  });

  try {
    // Migrate
    await withPgClient(pgPool, client => migrate(client));

    if (ONCE) {
      // Just run all jobs then exit
      await withPgClient(pgPool, client =>
        runAllJobs(watchedTasks.tasks, client)
      );
    } else {
      // Watch for new jobs
      const { promise } = start(watchedTasks.tasks, pgPool, JOBS);
      // Continue forever(ish)
      await promise;
    }
  } finally {
    await pgPool.end();
  }
}

main().catch(e => {
  console.error(e); // tslint:disable-line no-console
  process.exit(1);
});
