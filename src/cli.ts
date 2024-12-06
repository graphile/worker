#!/usr/bin/env node
import { loadConfig } from "graphile-config/load";
import * as yargs from "yargs";

import { assertCleanupTasks, cleanup } from "./cleanup";
import { getCronItemsInternal } from "./getCronItems";
import { getTasksInternal } from "./getTasks";
import { getUtilsAndReleasersFromOptions } from "./lib";
import { EMPTY_PRESET, WorkerPreset } from "./preset";
import { runInternal, runOnceInternal } from "./runner";

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
  })
  .number("jobs")
  .option("max-pool-size", {
    description: "maximum size of the PostgreSQL pool",
    alias: "m",
  })
  .number("max-pool-size")
  .option("poll-interval", {
    description:
      "how long to wait between polling for jobs in milliseconds (for jobs scheduled in the future/retries)",
  })
  .number("poll-interval")
  .option("no-prepared-statements", {
    description:
      "set this flag if you want to disable prepared statements, e.g. for compatibility with some external PostgreSQL pools",
  })
  .boolean("no-prepared-statements")
  .option("config", {
    alias: "C",
    description: "The path to the config file",
    normalize: true,
  })
  .string("config")
  .option("cleanup", {
    description:
      "Clean the database, then exit. Accepts a comma-separated list of cleanup tasks: GC_TASK_IDENTIFIERS, GC_JOB_QUEUES, DELETE_PERMAFAILED_JOBS",
  })
  .string("cleanup")
  .strict(true).argv;

const integerOrUndefined = (n: number | undefined): number | undefined => {
  return typeof n === "number" && isFinite(n) && Math.round(n) === n
    ? n
    : undefined;
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
      maxPoolSize: integerOrUndefined(inArgv["max-pool-size"]),
      pollInterval: integerOrUndefined(inArgv["poll-interval"]),
      preparedStatements: !inArgv["no-prepared-statements"],
      schema: inArgv.schema,
      crontabFile: inArgv["crontab"],
      concurrentJobs: integerOrUndefined(inArgv.jobs),
    }),
  };
}

async function main() {
  const userPreset = await loadConfig(argv.config);
  const ONCE = argv.once;
  const SCHEMA_ONLY = argv["schema-only"];
  const CLEANUP = argv.cleanup as string | string[] | undefined;

  if (SCHEMA_ONLY && ONCE) {
    throw new Error("Cannot specify both --once and --schema-only");
  }

  const argvPreset = argvToPreset(argv);

  const [compiledOptions, release] = await getUtilsAndReleasersFromOptions({
    preset: {
      extends: [WorkerPreset, userPreset ?? EMPTY_PRESET, argvPreset],
    },
  });
  try {
    if (
      !compiledOptions.resolvedPreset.worker.connectionString &&
      !process.env.PGDATABASE
    ) {
      throw new Error(
        "Please use `--connection` flag, set `DATABASE_URL` or `PGDATABASE` envvars to indicate the PostgreSQL connection to use.",
      );
    }

    if (SCHEMA_ONLY) {
      console.log("Schema updated");
      return;
    }

    const watchedTasks = await getTasksInternal(
      compiledOptions,
      compiledOptions.resolvedPreset.worker.taskDirectory,
    );
    compiledOptions.releasers.push(() => watchedTasks.release());

    if (CLEANUP != null) {
      const cleanups = Array.isArray(CLEANUP) ? CLEANUP : [CLEANUP];
      const cleanupTasks = cleanups
        .flatMap((t) => t.split(","))
        .map((t) => t.trim());
      assertCleanupTasks(cleanupTasks);
      await cleanup(compiledOptions, {
        tasks: cleanupTasks,
        taskIdentifiersToKeep: Object.keys(watchedTasks.tasks),
      });
      return;
    }

    const watchedCronItems = await getCronItemsInternal(
      compiledOptions,
      compiledOptions.resolvedPreset.worker.crontabFile,
    );
    compiledOptions.releasers.push(() => watchedCronItems.release());

    if (ONCE) {
      await runOnceInternal(compiledOptions, watchedTasks.tasks, () => {
        /* noop */
      });
    } else {
      const { promise } = await runInternal(
        compiledOptions,
        watchedTasks.tasks,
        watchedCronItems.items,
        () => {
          /*noop*/
        },
      );
      // Continue forever(ish)
      await promise;
    }
  } finally {
    const timer = setTimeout(() => {
      console.error(
        `Worker failed to exit naturally after 1 second; terminating manually. This may indicate a bug in Graphile Worker, or it might be that you triggered a forceful shutdown and some of your executing tasks have yet to exit.`,
      );
      process.exit(1);
    }, 1000);
    timer.unref();
    compiledOptions.logger.debug("CLI shutting down...");
    await release();
    compiledOptions.logger.debug("CLI shutdown complete.");
  }
}

main().catch((e) => {
  console.error(e); // eslint-disable-line no-console
  process.exit(1);
});
