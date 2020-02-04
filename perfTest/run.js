#!/usr/bin/env node
const { execSync } = require("child_process");

const time = cb => {
  const start = process.hrtime();
  cb();
  const diff = process.hrtime(start);
  const dur = diff[0] * 1e3 + diff[1] * 1e-6;
  console.log(`... it took ${dur.toFixed(0)}ms`);
  return dur;
};

// run in this script's parent directory
process.chdir(__dirname);

process.env.NO_LOG_SUCCESS = "1";

// if connection string not provided, assume postgres is available locally
process.env.PERF_DATABASE_URL = `${process.env.TEST_CONNECTION_STRING ||
  "graphile_worker_perftest"}`;

const env = {
  ...process.env,
  DATABASE_URL: process.env.PERF_DATABASE_URL,
};

const execOptions = {
  env,
  stdio: ["ignore", "ignore", "inherit"],
};

console.log("Dropping and recreating the test database");
execSync("node ./recreateDb.js", execOptions);

console.log("Installing the schema");
execSync("node ../dist/cli.js --schema-only", execOptions);

console.log();
console.log();
console.log("Timing startup/shutdown time...");
time(() => {
  execSync("node ../dist/cli.js --once", execOptions);
});
console.log();

console.log("Scheduling 20,000 jobs");
execSync("node ./init.js", execOptions);

console.log();
console.log();
console.log("Timing 20,000 job execution...");
const dur = time(() => {
  execSync("node ../dist/cli.js --once -j 24 -m 25", execOptions);
});
console.log(`Jobs per second: ${((1000 * 20000) / dur).toFixed(2)}`);
console.log();
console.log();

console.log("Testing latency...");
execSync("node ./latencyTest.js", {
  ...execOptions,
  stdio: "inherit",
});
