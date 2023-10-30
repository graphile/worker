#!/usr/bin/env node
import { loadConfig } from "graphile-config/load";
import * as yargs from "yargs";

import { defaults } from "./config";
import getCronItems from "./getCronItems";
import getTasks from "./getTasks";
import { run, runOnce } from "./index";
import { digestPreset, EMPTY_PRESET } from "./lib";
import { WorkerPreset } from "./preset";
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
  .option("config", {
    alias: "C",
    description: "The path to the config file",
    normalize: true,
  })
  .string("config")
  .strict(true).argv;

const isInteger = (n: number | undefined): boolean => {
  return typeof n === "number" && isFinite(n) && Math.round(n) === n;
};

function stripUndefined<T extends object>(
  t: T,
): { [Key in keyof T as T[Key] extends undefined ? never : Key]: T[Key] } {
  return Object.fromEntries(
    Object.entries(t).filter(([_, value]) => value !== undefined),
  ) as T;
}

function argvToPreset(inArgv: Awaited<typeof argv>): GraphileConfig.Preset {
  return {
    worker: stripUndefined({
      connectionString: inArgv["connection"],
      maxPoolSize: isInteger(inArgv["max-pool-size"])
        ? inArgv["max-pool-size"]
        : undefined,
      pollInterval: isInteger(inArgv["poll-interval"])
        ? inArgv["poll-interval"]
        : undefined,
      preparedStatements: !inArgv["no-prepared-statements"],
      schema: inArgv.schema,
      crontabFile: inArgv["crontab"],
      concurrentJobs: isInteger(inArgv.jobs) ? inArgv.jobs : undefined,
    }),
  };
}

async function main() {
  const userPreset = await loadConfig(argv.config);
  const ONCE = argv.once;
  const SCHEMA_ONLY = argv["schema-only"];

  if (SCHEMA_ONLY && ONCE) {
    throw new Error("Cannot specify both --once and --schema-only");
  }

  const {
    runnerOptions: options,
    tasksFolder,
    crontabFile,
  } = digestPreset({
    extends: [WorkerPreset, userPreset ?? EMPTY_PRESET, argvToPreset(argv)],
  });

  if (!options.connectionString) {
    throw new Error(
      "Please use `--connection` flag, set `DATABASE_URL` or `PGDATABASE` envvars to indicate the PostgreSQL connection to use.",
    );
  }

  if (SCHEMA_ONLY) {
    await runMigrations(options);
    console.log("Schema updated");
    return;
  }

  const watchedTasks = await getTasks(options, tasksFolder);
  const watchedCronItems = await getCronItems(options, crontabFile);

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
  watchedTasks.release();
  watchedCronItems.release();
  const timer = setTimeout(() => {
    console.error(
      `Worker failed to exit naturally after 10 seconds; terminating manually. This may indicate a bug in Graphile Worker.`,
    );
    process.exit(1);
  }, 10000);
  timer.unref();
}

main().catch((e) => {
  console.error(e); // eslint-disable-line no-console
  process.exit(1);
});
