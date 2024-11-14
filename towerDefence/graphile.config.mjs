// @ts-check

/** @typedef {import("../dist/index.js")} Worker  */
// import type {} from "../src/index.js";

// import { WorkerProPreset } from "../graphile-pro-worker/dist/index.js";

const CONCURRENT_JOBS = 10;

const stats = {
  jobsFetched: 0,
  jobsReturned: 0,
  timeInMode: {},
  timeInRefetchDelay: 0n,
  refetchDelays: 0,
  refetchDelayAborted: 0,
};

let lastModeStart = process.hrtime.bigint();
let refetchDelayStart = process.hrtime.bigint();

/** @type {GraphileConfig.Plugin} */
const TowerDefenceResultPlugin = {
  name: "TowerDefenceResultPlugin",
  version: "0.0.0",
  worker: {
    hooks: {
      init(ctx) {
        ctx.events.on("pool:release", (event) => {
          console.log(`Pool ${event.workerPool.id} released`);
          console.dir(stats);
        });
        ctx.events.on("localQueue:getJobs:complete", ({ jobs }) => {
          stats.jobsFetched += jobs.length;
        });
        ctx.events.on("localQueue:returnJobs", ({ jobs }) => {
          stats.jobsReturned += jobs.length;
        });
        ctx.events.on("localQueue:init", () => {
          lastModeStart = process.hrtime.bigint();
        });
        ctx.events.on("localQueue:setMode", ({ oldMode, newMode }) => {
          const now = process.hrtime.bigint();
          const diff = now - lastModeStart;
          lastModeStart = now;
          stats.timeInMode[oldMode] ??= 0n;
          stats.timeInMode[oldMode] += diff;
        });
        ctx.events.on("localQueue:refetchDelay:start", () => {
          stats.refetchDelays += 1;
          refetchDelayStart = process.hrtime.bigint();
        });
        ctx.events.on("localQueue:refetchDelay:abort", () => {
          stats.refetchDelaysAborted += 1;
          const elapsed = process.hrtime.bigint() - refetchDelayStart;
          stats.timeInRefetchDelay += elapsed;
        });
        ctx.events.on("localQueue:refetchDelay:expired", () => {
          const elapsed = process.hrtime.bigint() - refetchDelayStart;
          stats.timeInRefetchDelay += elapsed;
        });
      },
    },
  },
};

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
  plugins: [TowerDefenceResultPlugin],
};

export default preset;
