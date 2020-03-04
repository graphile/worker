import { cosmiconfigSync } from "cosmiconfig";

const cosmiconfigResult = cosmiconfigSync("graphile-worker").search();
const cosmiconfig = cosmiconfigResult?.config;

/**
 * Defaults to use for various options throughout the codebase, sourced from
 * environmental variables, cosmiconfig, and finally sensible defaults.
 */
interface WorkerDefaults {
  /**
   * How long to wait between polling for jobs.
   *
   * Note: this does NOT need to be short, because we use LISTEN/NOTIFY to be
   * notified when new jobs are added - this is just used for jobs scheduled in
   * the future, retried jobs, and in the case where LISTEN/NOTIFY fails for
   * whatever reason.
   */
  pollInterval: number;

  /**
   * Which PostgreSQL schema should Graphile Worker use? Defaults to 'graphile_worker'.
   */
  schema: string;

  /**
   * How many errors in a row can we get fetching a job before we raise a higher
   * exception?
   */
  maxContiguousErrors: number;

  /**
   * Number of jobs to run concurrently
   */
  concurrentJobs: number;

  /**
   * The maximum size of the PostgreSQL pool. Defaults to the node-postgres
   * default (10). Only useful when `connectionString` is given.
   */
  maxPoolSize: number;
}

export const defaults: WorkerDefaults = {
  schema:
    process.env.GRAPHILE_WORKER_SCHEMA ||
    enforceStringOrUndefined("schema", cosmiconfig?.schema) ||
    "graphile_worker",
  maxContiguousErrors:
    enforceNumberOrUndefined(
      "maxContiguousErrors",
      cosmiconfig?.maxContiguousErrors
    ) || 10,
  pollInterval:
    enforceNumberOrUndefined("pollInterval", cosmiconfig?.pollInterval) || 2000,
  concurrentJobs:
    enforceNumberOrUndefined("concurrentJobs", cosmiconfig?.concurrentJobs) ||
    1,
  maxPoolSize:
    enforceNumberOrUndefined("maxPoolSize", cosmiconfig?.maxPoolSize) || 10,
};

function enforceStringOrUndefined(
  keyName: String,
  str: unknown
): string | undefined {
  if (typeof str === "string") {
    return str;
  } else if (!str) {
    return undefined;
  } else {
    throw new Error(
      `Expected '${keyName}' to be a string (or not set), but received ${typeof str}`
    );
  }
}

function enforceNumberOrUndefined(
  keyName: String,
  nr: unknown
): number | undefined {
  if (typeof nr === "number") {
    return nr;
  } else if (typeof nr === "string") {
    const val = parseFloat(nr);
    if (isFinite(val)) {
      return val;
    } else {
      throw new Error(
        `Expected '${keyName}' to be a number (or not set), but received ${nr}`
      );
    }
  } else if (!nr) {
    return undefined;
  } else {
    throw new Error(
      `Expected '${keyName}' to be a number (or not set), but received ${typeof nr}`
    );
  }
}
