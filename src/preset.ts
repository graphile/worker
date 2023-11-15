import { defaults } from "./config";
import { MINUTE, SECOND } from "./cronConstants";
import { defaultLogger } from "./logger";
import { LoadTaskFromExecutableFilePlugin } from "./plugins/LoadTaskFromExecutableFilePlugin";
import { LoadTaskFromJsPlugin } from "./plugins/LoadTaskFromJsPlugin";

export const workerPresetWorkerOptions = {
  connectionString: defaults.connectionString,
  schema: defaults.schema,
  pollInterval: defaults.pollInterval,
  concurrentJobs: defaults.concurrentJobs,
  maxPoolSize: defaults.maxPoolSize,
  preparedStatements: defaults.preparedStatements,
  crontabFile: defaults.crontabFile,
  taskDirectory: defaults.taskDirectory,
  fileExtensions: [".js", ".cjs", ".mjs"],
  logger: defaultLogger,
  minResetLockedInterval: 8 * MINUTE,
  maxResetLockedInterval: 10 * MINUTE,
  gracefulShutdownAbortTimeout: 5 * SECOND,
  useNodeTime: false,
} satisfies GraphileConfig.WorkerOptions;

export const WorkerPreset: GraphileConfig.Preset = {
  plugins: [LoadTaskFromJsPlugin, LoadTaskFromExecutableFilePlugin],
  worker: workerPresetWorkerOptions,
};

export const EMPTY_PRESET: GraphileConfig.Preset = Object.freeze({});
