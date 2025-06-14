#!/usr/bin/env node
// @ts-check
import { execSync, spawn } from "child_process";
import pg from "pg";

import { makeWorkerUtils } from "../dist/index.js";
import config, { PARALLELISM } from "./graphile.config.mjs";

const CONCURRENCY = config.worker?.concurrentJobs ?? 1;
/** How long each individual task sleeps for */
const SLEEP_TIME = 50;

const STUCK_JOB_COUNT = 0;
const WAVES = [
  makeWave([1]),
  makeWave(new Array(1000).fill(1), 10),
  makeWave(new Array(1000).fill(1), 5),
  makeWave(new Array(3000).fill(1), 1),
  makeWave(new Array(5000).fill(1)),
  makeWave(new Array(5000).fill(4)),
  makeWave(new Array(200).fill(200)),
  makeWave(Array.from({ length: 50 }, repeat([2000, 200, 20, 2])), 5),
];

/** @type {<T>(arr: T[]) => (_: any, i: number) => T} */
function repeat(arr) {
  return (_, i) => arr[i % arr.length];
}

const taskIdentifier = "log_if_999";

const __dirname = new URL(".", import.meta.url).pathname;

// run in this script's parent directory
process.chdir(__dirname);

process.env.NO_LOG_SUCCESS = "1";

// if connection string not provided, assume postgres is available locally
process.env.PERF_DATABASE_URL ??= `${
  process.env.TEST_CONNECTION_STRING || "postgres:///graphile_worker_perftest"
}`;

const env = {
  ...process.env,
  DATABASE_URL: process.env.PERF_DATABASE_URL,
};

/** @type {import("child_process").CommonExecOptions} */
const execOptions = {
  env,
  stdio: ["ignore", "ignore", "inherit"],
};

/** @type {import("child_process").SpawnOptions} */
const spawnOptions = {
  env,
  stdio: ["ignore", "inherit", "inherit"],
  detached: false,
};

const pgPool = new pg.Pool({ connectionString: process.env.PERF_DATABASE_URL });
pgPool.on("error", () => {});
pgPool.on("connect", (client) => void client.on("error", () => {}));

//const GENERAL_JOBS_PER_SECOND = 15000;
const GENERAL_JOBS_PER_SECOND = Math.min(
  15000,
  CONCURRENCY * PARALLELISM * (1000 / (SLEEP_TIME + 0.1)),
);
const GENERAL_JOBS_PER_MILLISECOND = GENERAL_JOBS_PER_SECOND / 1000;

/** @type {(jobBatches: number[], sleepDuration?: number) => (workerUtils: import("../dist/interfaces.js").WorkerUtils) => Promise<void>} */
function makeWave(jobBatches, extraSleepDuration = -1) {
  return async (workerUtils) => {
    let totalCount = 0;
    let start = Date.now();
    for (let i = 0; i < jobBatches.length; i++) {
      const NOW = new Date();
      const jobCount = jobBatches[i];
      /** @type {import("../dist/index.js").AddJobsJobSpec[]} */
      const jobs = [];
      for (let i = 0; i < jobCount; i++) {
        totalCount++;
        jobs.push({
          identifier: taskIdentifier,
          payload: {
            id: i,
            sleepTime: SLEEP_TIME,
          },
          runAt: NOW,
        });
      }
      await workerUtils.addJobs(jobs);
      const sleepDuration =
        Math.floor((jobCount * SLEEP_TIME) / (CONCURRENCY * PARALLELISM)) +
        extraSleepDuration;
      if (sleepDuration >= 0) {
        await sleep(sleepDuration);
      }
    }

    // Give roughly enough time for the jobs to complete
    const estimatedExecutionTime = totalCount / GENERAL_JOBS_PER_MILLISECOND;

    const elapsed = Date.now() - start;
    const timeToSleep = estimatedExecutionTime - elapsed;
    if (timeToSleep > 0) {
      await sleep(timeToSleep);
    }

    // And wait for the jobs table to be empty
    const MAX_ATTEMPTS = 20;
    for (let attempts = 0; attempts < MAX_ATTEMPTS; attempts++) {
      const {
        rows: [{ count }],
      } = await pgPool.query(
        `select count(*) from graphile_worker.jobs where task_identifier <> 'stuck';`,
      );
      if (count === "0") {
        break;
      }
      if (attempts === MAX_ATTEMPTS - 1) {
        throw new Error(`Expected 0 jobs, got ${count}`);
      } else {
        await sleep(50 * (attempts + 1) ** 1.5);
      }
    }
  };
}

/** @type {(ms: number) => Promise<void>} */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {(cb: () => any) => Promise<number>} */
const time = async (cb) => {
  const start = process.hrtime();
  await cb();
  const diff = process.hrtime(start);
  const dur = diff[0] * 1e3 + diff[1] * 1e-6;
  console.log(`... it took ${dur.toFixed(0)}ms`);
  return dur;
};

async function main() {
  console.log("Building");
  execSync("yarn prepack", execOptions);

  console.log("Dropping and recreating the test database");
  execSync("node ../perfTest/recreateDb.js", execOptions);

  console.log("Installing the schema");
  execSync("node ../dist/cli.js --schema-only", execOptions);

  const workerUtils = await makeWorkerUtils({
    pgPool,
  });

  if (STUCK_JOB_COUNT > 0) {
    console.log(`Scheduling ${STUCK_JOB_COUNT} stuck jobs`);
    await time(() => {
      execSync(
        `node ../perfTest/init.js ${STUCK_JOB_COUNT} stuck`,
        execOptions,
      );
    });
  }

  console.log();
  console.log();
  console.log(`Spawning ${PARALLELISM} workers...`);
  /** @type {import("child_process").PromiseWithChild<any>[]} */
  const workerPromises = [];
  for (let i = 0; i < PARALLELISM; i++) {
    const child = spawn(`node`, [`../dist/cli.js`], spawnOptions);
    const promise = Object.assign(
      new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("exit", resolve);
      }),
      { child },
    );
    workerPromises.push(promise);
  }

  const allDone = Promise.all(workerPromises).then(
    () => {
      console.log("All workers exited cleanly");
    },
    (e) => {
      /** @type {import("child_process").ExecException} */
      const err = e;
      if (err.signal === "SIGTERM") {
        // all good; we terminated it
      } else {
        console.dir(err);
        process.exit(1);
      }
    },
  );

  await sleep(2000);
  console.log("The wait is over... starting the attack");
  console.log();
  console.log();

  for (let waveNumber = 0; waveNumber < WAVES.length; waveNumber++) {
    const wave = WAVES[waveNumber];
    console.log(`Wave ${waveNumber + 1}...`);
    await wave(workerUtils);
    console.log();
    console.log();
  }

  console.log("Waves complete; waiting for workers to finish");
  for (const { child } of workerPromises) {
    child.kill("SIGTERM");
  }

  await allDone;

  console.log("Exiting");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
