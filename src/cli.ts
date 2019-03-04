import { Pool } from "pg";
import { migrate } from "./migrate";
import { getTasks } from "./getTasks";
import { start, runAllJobs } from "./main";

// TODO: use a proper CLI parser!
const ONCE = process.argv.slice(2).includes("--once");
const WATCH = process.argv.slice(2).includes("--watch");

async function main() {
  if (WATCH && ONCE) {
    throw new Error("Cannot specify both --watch and --once");
  }

  const watchedTasks = await getTasks(`${process.cwd()}/tasks`, WATCH);

  const pgPool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await migrate(pgPool);

    if (ONCE) {
      const client = await pgPool.connect();
      try {
        await runAllJobs(watchedTasks.tasks, client);
      } finally {
        await client.release();
      }
    } else {
      const { promise } = start(watchedTasks.tasks, pgPool);
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
