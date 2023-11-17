// import "graphile-config";

// import { WorkerProPreset } from "../graphile-pro-worker/dist/index.js";
// import type {} from "../src/index.js";

/** @type {GraphileConfig.Preset} */
const preset = {
  // extends: [WorkerProPreset],
  worker: {
    connectionString:
      process.env.PERF_DATABASE_URL || "postgres:///graphile_worker_perftest",
    concurrentJobs: 3,
    fileExtensions: [".js", ".cjs", ".mjs"],
    // fileExtensions: [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"],
    gracefulShutdownAbortTimeout: 2500,
  },
};
module.exports = preset;
