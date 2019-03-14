import { Pool, PoolClient } from "pg";
import { migrate } from "./migrate";
import getTasks from "./getTasks";
import { start, runAllJobs } from "./main";
import * as yargs from "yargs";

const argv = yargs
  .option("once", {
    alias: "1",
    default: false
  })
  .boolean("once")
  .option("watch", {
    alias: "w",
    default: false
  })
  .boolean("watch")
  .option("jobs", {
    alias: "j",
    default: 1
  }).argv;

const ONCE = argv.once;
const WATCH = argv.watch;
const JOBS = argv.jobs;

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
  const watchedTasks = await getTasks(`${process.cwd()}/tasks`, WATCH);

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL
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
