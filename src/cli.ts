#!/usr/bin/env node
import getTasks from "./getTasks";
import { RunnerOptions } from "./interfaces";
import { run, runOnce } from "./index";
import * as yargs from "yargs";
import { POLL_INTERVAL, CONCURRENT_JOBS } from "./config";
import { defaultLogger } from "./logger";

const argv = yargs
  .option("connection", {
    description:
      "Database connection string, defaults to the 'DATABASE_URL' envvar",
    alias: "c",
  })
  .string("connection")
  .option("once", {
    description: "Run until there are no runnable jobs left, then exit",
    default: false,
  })
  .boolean("once")
  .option("watch", {
    description:
      "[EXPERIMENTAL] Watch task files for changes, automatically reloading the task code without restarting worker",
    alias: "w",
    default: false,
  })
  .boolean("watch")
  .option("jobs", {
    description: "number of jobs to run concurrently",
    alias: "j",
    default: CONCURRENT_JOBS,
  })
  .option("poll-interval", {
    description:
      "how long to wait between polling for jobs in milliseconds (for jobs scheduled in the future/retries)",
    default: POLL_INTERVAL,
  })
  .number("poll-interval")
  .strict(true).argv;

if (argv._.length > 0) {
  console.error(`Unrecognised additional arguments: '${argv._.join("', '")}'`);
  console.error();
  yargs.showHelp();
  process.exit(1);
}

const isInteger = (n: number): boolean => {
  return isFinite(n) && Math.round(n) === n;
};

async function main() {
  const DATABASE_URL = argv.connection || process.env.DATABASE_URL || undefined;
  const ONCE = argv.once;
  const WATCH = argv.watch;

  if (WATCH && ONCE) {
    throw new Error("Cannot specify both --watch and --once");
  }

  if (!DATABASE_URL) {
    throw new Error(
      "Please use `--connection` flag or set `DATABASE_URL` envvar to indicate the PostgreSQL connection string."
    );
  }

  // TODO: allow overriding the logger
  const logger = defaultLogger;

  const watchedTasks = await getTasks(`${process.cwd()}/tasks`, WATCH, logger);

  const options: RunnerOptions = {
    concurrency: isInteger(argv.jobs) ? argv.jobs : CONCURRENT_JOBS,
    pollInterval: isInteger(argv["poll-interval"])
      ? argv["poll-interval"]
      : POLL_INTERVAL,
    connectionString: DATABASE_URL,
    taskList: watchedTasks.tasks,
    logger,
  };

  if (ONCE) {
    await runOnce(options);
  } else {
    const { promise } = await run(options);
    // Continue forever(ish)
    await promise;
  }
}

main().catch(e => {
  console.error(e); // eslint-disable-line no-console
  process.exit(1);
});
