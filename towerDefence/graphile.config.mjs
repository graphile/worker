// @ts-check

/** @typedef {import("../dist/index.js")} Worker  */
// import type {} from "../src/index.js";

// import { WorkerProPreset } from "../graphile-pro-worker/dist/index.js";

const CONCURRENT_JOBS = 10;

const stats = {
  jobsFetched: 0,
  jobsReturned: 0,
  timeInMode: Object.create(null),
  timeInRefetchDelay: 0n,
  refetchDelays: 0,
  refetchDelayAborted: 0,
};

let lastModeStart = process.hrtime.bigint();
let refetchDelayStart = process.hrtime.bigint();

/** @type {(value: number | string, width?: number, char?: string) => string} */
const p = (v, w = 10, s = " ") => String(v).padStart(w, s);

/** @type {(t: bigint) => string} */
const ms = (t) => {
  return `${(Number(t) / 1e6).toFixed(2)}ms`;
};

/** @type {() => string} */
const tim = () => {
  let results = [];
  for (const m in stats.timeInMode) {
    results.push(p(`${p(m)}=${ms(stats.timeInMode[m])}`, 19));
  }
  return results.join(",");
};

/** @type {GraphileConfig.Plugin} */
const TowerDefenceResultPlugin = {
  name: "TowerDefenceResultPlugin",
  version: "0.0.0",
  worker: {
    hooks: {
      init(ctx) {
        ctx.events.on("pool:release", (event) => {
          console.log(
            `\nPool ${event.workerPool.id} released\nFetched=${p(
              stats.jobsFetched,
              6,
            )}|Returned=${p(stats.jobsReturned, 6)}|TotalDelay=${p(
              ms(stats.timeInRefetchDelay),
              11,
            )}(Aborted=${p(
              `${stats.refetchDelayAborted}/${stats.refetchDelays}`,
              9,
            )})|${tim()}\n`,
          );
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

    localQueue: { size: 500, refetchDelay: { durationMs: 100 } },
    completeJobBatchDelay: 0,
    failJobBatchDelay: 0,
  },
  plugins: [TowerDefenceResultPlugin],
};

export default preset;
