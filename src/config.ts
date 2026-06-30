import { cosmiconfigSync } from "cosmiconfig";

import { MINUTE, SECOND } from "./cronConstants.ts";
import { defaultLogger } from "./logger.ts";

const cosmiconfigResult = cosmiconfigSync("graphile-worker").search();

if (cosmiconfigResult && !cosmiconfigResult.isEmpty) {
  const { config: cosmiconfig, filepath } = cosmiconfigResult;
  if (
    cosmiconfig.schema != null ||
    cosmiconfig.pollInterval != null ||
    cosmiconfig.maxPoolSize != null
  ) {
    console.error(
      `Cosmiconfig configuration found in ${filepath}. cosmiconfig is no longer supported, please switch to graphile.config.ts - an equivalent configuration might look like:`,
    );
    console.error();
    console.error("```ts");
    console.error("// graphile.config.ts");
    console.error('import { WorkerPreset } from "graphile-worker";');
    console.error("");
    console.error("const preset: GraphileConfig.Preset = {");
    console.error("  extends: [WorkerPreset],");
    console.error("  worker: {");
    if (cosmiconfig.schema != null) {
      console.error(`    schema: ${JSON.stringify(cosmiconfig.schema)},`);
    }
    if (cosmiconfig.pollInterval != null) {
      console.error(
        `    pollInterval: ${JSON.stringify(cosmiconfig.pollInterval)},`,
      );
    }
    if (cosmiconfig.maxPoolSize != null) {
      console.error(
        `    maxPoolSize: ${JSON.stringify(cosmiconfig.maxPoolSize)},`,
      );
    }
    console.error("  },");
    console.error("};");
    console.error("");
    console.error("export default preset;");
    console.error("```");
    process.exit(1);
  }
}

/**
 * Defaults to use for various options throughout the codebase, sourced from
 * environmental variables, cosmiconfig, and finally sensible defaults.
 */
export const makeWorkerPresetWorkerOptions = () =>
  ({
    connectionString: process.env.DATABASE_URL,
    schema: process.env.GRAPHILE_WORKER_SCHEMA || "graphile_worker",
    pollInterval: 2000,
    concurrentJobs: 1,
    maxPoolSize: 10,
    preparedStatements: true as boolean,
    crontabFile: `${process.cwd()}/crontab`,
    taskDirectory: `${process.cwd()}/tasks`,
    fileExtensions: [".js", ".cjs", ".mjs", ".ts", ".mts"],
    logger: defaultLogger,
    minResetLockedInterval: 8 * MINUTE,
    maxResetLockedInterval: 10 * MINUTE,
    gracefulShutdownAbortTimeout: 5 * SECOND,
    useNodeTime: false,
  }) satisfies GraphileConfig.WorkerOptions;
