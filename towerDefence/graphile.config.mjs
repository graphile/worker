// @ts-check

/** @typedef {import("../dist/index.js")} Worker  */
// import type {} from "../src/index.js";

// import { WorkerProPreset } from "../graphile-pro-worker/dist/index.js";

const CONCURRENT_JOBS = 10;
export const PARALLELISM = 10;

const stats = {
  fetches: 0,
  emptyFetches: 0,
  jobsFetched: 0,
  jobsReturned: 0,
  timeInMode: Object.create(null),
  timeInRefetchDelay: 0n,
  refetchDelays: 0,
  refetchDelaysAborted: 0,
  maxLatency: 0,
  latencySum: 0,
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
            `\nPool ${event.workerPool.id} released\nFetches=${p(
              stats.fetches,
              5,
            )}(empty=${p(stats.emptyFetches, 5)};maxLatency=${p(
              stats.maxLatency,
              4,
            )}ms;avgLatency=${p(
              stats.jobsFetched
                ? (stats.latencySum / stats.jobsFetched).toFixed(2)
                : "-",
              8,
            )}ms)|Fetched=${p(stats.jobsFetched, 6)}|Returned=${p(
              stats.jobsReturned,
              6,
            )}|TotalDelay=${p(ms(stats.timeInRefetchDelay), 11)}(Aborted=${p(
              `${stats.refetchDelaysAborted}/${stats.refetchDelays}`,
              9,
            )})|${tim()}\n`,
          );
        });
        ctx.events.on("localQueue:getJobs:complete", ({ jobs }) => {
          stats.fetches += 1;
          if (jobs.length === 0) {
            stats.emptyFetches += 1;
          }
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
        ctx.events.on("job:start", (event) => {
          const l = Date.now() - +event.job.run_at;
          stats.latencySum += l;
          if (l > stats.maxLatency) {
            stats.maxLatency = l;
          }
        });
      },
    },
  },
};

const localQueueSize = CONCURRENT_JOBS + 1;

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

    pollInterval: 2000,
    localQueue: {
      size: localQueueSize,
      refetchDelay: {
        durationMs: 1000,
        threshold: localQueueSize - 1,
        maxAbortThreshold: CONCURRENT_JOBS * PARALLELISM,
      },
    },
    completeJobBatchDelay: 0,
    failJobBatchDelay: 0,
  },
  plugins: [TowerDefenceResultPlugin],
};

export default preset;
