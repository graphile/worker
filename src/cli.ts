#!/usr/bin/env node
import * as yargs from "yargs";

import { defaults } from "./config";
import getCronItems from "./getCronItems";
import getTasks from "./getTasks";
import { run, runOnce } from "./index";
import { RunnerOptions } from "./interfaces";
import { runMigrations } from "./runner";

const argv = yargs
  .parserConfiguration({
    "boolean-negation": false,
  })
  .option("connection", {
    description:
      "Database connection string, defaults to the 'DATABASE_URL' envvar",
    alias: "c",
  })
  .string("connection")
  .option("schema", {
    description:
      "The database schema in which Graphile Worker is (to be) located",
    alias: "s",
    default: defaults.schema,
  })
  .string("schema")
  .option("schema-only", {
    description: "Just install (or update) the database schema, then exit",
    default: false,
  })
  .boolean("schema-only")
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
  .option("crontab", {
    description: "override path to crontab file",
  })
  .string("crontab")
  .option("jobs", {
    description: "number of jobs to run concurrently",
    alias: "j",
    default: defaults.concurrentJobs,
  })
  .number("jobs")
  .option("max-pool-size", {
    description: "maximum size of the PostgreSQL pool",
    alias: "m",
    default: 10,
  })
  .number("max-pool-size")
  .option("poll-interval", {
    description:
      "how long to wait between polling for jobs in milliseconds (for jobs scheduled in the future/retries)",
    default: defaults.pollInterval,
  })
  .number("poll-interval")
  .option("no-prepared-statements", {
    description:
      "set this flag if you want to disable prepared statements, e.g. for compatibility with pgBouncer",
    default: false,
  })
  .boolean("no-prepared-statements")
  .strict(true).argv;

if (argv._.length > 0) {
  console.error(`Unrecognized additional arguments: '${argv._.join("', '")}'`);
  console.error();
  yargs.showHelp();
  process.exit(1);
}

const isInteger = (n: number): boolean => {
  return isFinite(n) && Math.round(n) === n;
};

async function main() {
  const DATABASE_URL = argv.connection || process.env.DATABASE_URL || undefined;
  const SCHEMA = argv.schema || undefined;
  const ONCE = argv.once;
  const SCHEMA_ONLY = argv["schema-only"];
  const WATCH = argv.watch;

  if (SCHEMA_ONLY && WATCH) {
    throw new Error("Cannot specify both --watch and --schema-only");
  }
  if (SCHEMA_ONLY && ONCE) {
    throw new Error("Cannot specify both --once and --schema-only");
  }
  if (WATCH && ONCE) {
    throw new Error("Cannot specify both --watch and --once");
  }

  if (!DATABASE_URL && !process.env.PGDATABASE) {
    throw new Error(
      "Please use `--connection` flag, set `DATABASE_URL` or `PGDATABASE` envvars to indicate the PostgreSQL connection to use.",
    );
  }

  const options: RunnerOptions = {
    schema: SCHEMA || defaults.schema,
    concurrency: isInteger(argv.jobs) ? argv.jobs : defaults.concurrentJobs,
    maxPoolSize: isInteger(argv["max-pool-size"])
      ? argv["max-pool-size"]
      : defaults.maxPoolSize,
    pollInterval: isInteger(argv["poll-interval"])
      ? argv["poll-interval"]
      : defaults.pollInterval,
    connectionString: DATABASE_URL,
    noPreparedStatements: !!argv["no-prepared-statements"],
  };

  if (SCHEMA_ONLY) {
    await runMigrations(options);
    console.log("Schema updated");
    return;
  }

  const watchedTasks = await getTasks(options, `${process.cwd()}/tasks`, WATCH);
  const watchedCronItems = await getCronItems(
    options,
    argv.crontab || `${process.cwd()}/crontab`,
    WATCH,
  );

  if (ONCE) {
    await runOnce(options, watchedTasks.tasks);
  } else {
    const { promise } = await run(
      options,
      watchedTasks.tasks,
      watchedCronItems.items,
    );
    // Continue forever(ish)
    await promise;
  }
}

main().catch((e) => {
  console.error(e); // eslint-disable-line no-console
  process.exit(1);
});
