import { cosmiconfigSync } from "cosmiconfig";

const cosmiconfigResult = cosmiconfigSync("graphile-worker").search();
const cosmiconfig = cosmiconfigResult?.config;

/**
 * Defaults to use for various options throughout the codebase, sourced from
 * environmental variables, cosmiconfig, and finally sensible defaults.
 */
export const defaults = {
  // TODO: infer full connection string from PG* envvars
  connectionString: process.env.DATABASE_URL || process.env.PGDATABASE,
  schema:
    process.env.GRAPHILE_WORKER_SCHEMA ||
    enforceStringOrUndefined("schema", cosmiconfig?.schema) ||
    "graphile_worker",
  pollInterval:
    enforceNumberOrUndefined("pollInterval", cosmiconfig?.pollInterval) || 2000,
  concurrentJobs:
    enforceNumberOrUndefined("concurrentJobs", cosmiconfig?.concurrentJobs) ||
    1,
  maxPoolSize:
    enforceNumberOrUndefined("maxPoolSize", cosmiconfig?.maxPoolSize) || 10,
  preparedStatements: true,
  crontabFile: `${process.cwd()}/crontab`,
  tasksFolder: `${process.cwd()}/tasks`,
} satisfies GraphileConfig.WorkerOptions;

function enforceStringOrUndefined(
  keyName: string,
  str: unknown,
): string | undefined {
  if (typeof str === "string") {
    return str;
  } else if (!str) {
    return undefined;
  } else {
    throw new Error(
      `Expected '${keyName}' to be a string (or not set), but received ${typeof str}`,
    );
  }
}

function enforceNumberOrUndefined(
  keyName: string,
  nr: unknown,
): number | undefined {
  if (typeof nr === "number") {
    return nr;
  } else if (typeof nr === "string") {
    const val = parseFloat(nr);
    if (isFinite(val)) {
      return val;
    } else {
      throw new Error(
        `Expected '${keyName}' to be a number (or not set), but received ${nr}`,
      );
    }
  } else if (!nr) {
    return undefined;
  } else {
    throw new Error(
      `Expected '${keyName}' to be a number (or not set), but received ${typeof nr}`,
    );
  }
}
