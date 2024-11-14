// @ts-check

/** @typedef {import("../dist/index.js")} Worker  */
// import type {} from "../src/index.js";

// import { WorkerProPreset } from "../graphile-pro-worker/dist/index.js";

const CONCURRENT_JOBS = 10;

/** @type {GraphileConfig.Preset} */
const preset = {
  // extends: [WorkerProPreset],
  worker: {
    connectionString:
      process.env.PERF_DATABASE_URL || "postgres:///graphile_worker_perftest",
    fileExtensions: [".js", ".cjs", ".mjs"],
    // fileExtensions: [".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"],
    gracefulShutdownAbortTimeout: 2500,

    concurrentJobs: CONCURRENT_JOBS,
    maxPoolSize: CONCURRENT_JOBS + 1,

    //localQueue: { size: -1 },
    //completeJobBatchDelay: -1,
    //failJobBatchDelay: -1,

    localQueue: { size: 500, refetchDelay: { durationMs: 10 } },
    completeJobBatchDelay: 0,
    failJobBatchDelay: 0,
  },
};

export default preset;
