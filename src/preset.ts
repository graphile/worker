import { defaults } from "./config";
import { LoadTaskFromJsPlugin } from "./plugins/LoadTaskFromJsPlugin";

export const WorkerPreset: GraphileConfig.Preset = {
  plugins: [LoadTaskFromJsPlugin],
  worker: {
    connectionString: defaults.connectionString,
    schema: defaults.schema,
    pollInterval: defaults.pollInterval,
    concurrentJobs: defaults.concurrentJobs,
    maxPoolSize: defaults.maxPoolSize,
    preparedStatements: defaults.preparedStatements,
    crontabFile: defaults.crontabFile,
    tasksFolder: defaults.tasksFolder,
    fileExtensions: [".js", ".cjs", ".mjs"],
  },
};

export const EMPTY_PRESET: GraphileConfig.Preset = Object.freeze({});
