#!/usr/bin/env node
const { execSync, exec: rawExec } = require("child_process");
const { promisify } = require("util");
const exec = promisify(rawExec);

const JOB_COUNT = 20000;
const STUCK_JOB_COUNT = 0;
const PARALLELISM = 4;
const CONCURRENCY = 10;

const time = async (cb) => {
  const start = process.hrtime();
  await cb();
  const diff = process.hrtime(start);
  const dur = diff[0] * 1e3 + diff[1] * 1e-6;
  console.log(`... it took ${dur.toFixed(0)}ms`);
  return dur;
};

// run in this script's parent directory
process.chdir(__dirname);

process.env.NO_LOG_SUCCESS = "1";

// if connection string not provided, assume postgres is available locally
process.env.PERF_DATABASE_URL = `${
  process.env.TEST_CONNECTION_STRING || "postgres:///graphile_worker_perftest"
}`;

const env = {
  ...process.env,
  DATABASE_URL: process.env.PERF_DATABASE_URL,
};

const execOptions = {
  env,
  stdio: ["ignore", "ignore", "inherit"],
};

async function main() {
  console.log("Building");
  execSync("yarn prepack", execOptions);

  console.log("Dropping and recreating the test database");
  execSync("node ./recreateDb.js", execOptions);

  console.log("Installing the schema");
  execSync("node ../dist/cli.js --schema-only", execOptions);

  console.log();
  console.log();
  console.log("Timing startup/shutdown time...");
  let result;
  const startupTime = await time(async () => {
    result = await exec(`node ../dist/cli.js --once`, execOptions);
  });
  logResult(result);
  console.log();

  if (STUCK_JOB_COUNT > 0) {
    console.log(`Scheduling ${STUCK_JOB_COUNT} stuck jobs`);
    await time(() => {
      execSync(`node ./init.js ${STUCK_JOB_COUNT} stuck`, execOptions);
    });
  }

  console.log(`Scheduling ${JOB_COUNT} jobs`);
  await time(() => {
    execSync(`node ./init.js ${JOB_COUNT}`, {
      ...execOptions,
      stdio: "inherit",
    });
  });

  console.log();
  console.log();
  console.log(`Timing ${JOB_COUNT} job execution...`);
  const dur = await time(async () => {
    const promises = [];
    for (let i = 0; i < PARALLELISM; i++) {
      promises.push(
        exec(
          `node ../dist/cli.js --once -j ${CONCURRENCY} -m ${CONCURRENCY + 1}`,
          execOptions,
        ),
      );
    }
    (await Promise.all(promises)).map(logResult);
  });
  console.log(
    `Jobs per second: ${((1000 * JOB_COUNT) / (dur - startupTime)).toFixed(2)}`,
  );
  console.log();
  console.log();

  console.log("Testing latency...");
  execSync("node ./latencyTest.js", {
    ...execOptions,
    stdio: "inherit",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function logResult({ error, stdout, stderr }) {
  if (error) {
    throw error;
  }
  if (stdout) {
    console.log(stdout);
  }
  if (stderr) {
    console.error(stderr);
  }
}
