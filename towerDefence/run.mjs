#!/usr/bin/env node
// @ts-check
import { execSync, spawn } from "child_process";
import pg from "pg";
import { promisify } from "util";

const STUCK_JOB_COUNT = 0;
const PARALLELISM = 10;
const WAVES = [makeWave([1])];

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

/** @type {import("child_process").CommonSpawnOptions} */
const spawnOptions = {
  env,
  stdio: ["ignore", "inherit", "inherit"],
};

const pgPool = new pg.Pool({ connectionString: process.env.PERF_DATABASE_URL });

const GENERAL_JOBS_PER_SECOND = 15000;
const GENERAL_JOBS_PER_MILLISECOND = GENERAL_JOBS_PER_SECOND / 1000;

/** @type {(jobBatches: number[]) => () => Promise<void>} */
function makeWave(jobBatches) {
  return async () => {
    let totalCount = 0;
    for (let i = 0; i < jobBatches.length; i++) {
      const jobCount = jobBatches[i];
      const jobs = [];
      for (let i = 0; i < jobCount; i++) {
        totalCount++;
        jobs.push(
          `("${taskIdentifier.replace(
            /["\\]/g,
            "\\$&",
          )}","{\\"id\\":${i}}",,,,,,)`,
        );
      }
      const jobsString = `{"${jobs
        .map((j) => j.replace(/["\\]/g, "\\$&"))
        .join('","')}"}`;
      await pgPool.query(
        `select graphile_worker.add_jobs($1::graphile_worker.job_spec[]);`,
        [jobsString],
      );
    }

    // Give roughly enough time for the jobs to complete
    await sleep(totalCount / GENERAL_JOBS_PER_MILLISECOND);

    // And then wait a bit longer
    await sleep(10000);

    // And check the jobs table is empty
    const {
      rows: [{ count }],
    } = await pgPool.query(
      `select count(*) from graphile_worker.jobs where task_identifier <> 'stuck';`,
    );
    if (count !== "0") {
      throw new Error(`Expected 0 jobs, got ${count}`);
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
    await wave();
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
