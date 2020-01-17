const assert = require("assert");
const { Pool } = require("pg");
const { runTaskList } = require("../dist/main");
const { default: deferred } = require("../dist/deferred");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const pgPool = new Pool({ connectionString: process.env.PERF_DATABASE_URL });
  const startTimes = {};
  let latencies = [];
  const deferreds = {};
  const tasks = {
    latency: ({ id }) => {
      latencies.push(process.hrtime(startTimes[id]));
      if (deferreds[id]) {
        deferreds[id].resolve();
      }
    },
  };
  const workerPool = runTaskList(tasks, pgPool, 1);

  // Warm up
  await pgPool.query(
    `select graphile_worker.add_job('latency', json_build_object('id', -i)) from generate_series(1, 100) i`
  );
  await forEmptyQueue(pgPool);
  // Reset
  latencies = [];

  // Let things settle
  await sleep(1000);

  console.log("Beginning latency test");

  const SAMPLES = 1000;

  {
    const client = await pgPool.connect();
    try {
      for (let id = 0; id < SAMPLES; id++) {
        deferreds[id] = deferred();
        startTimes[id] = process.hrtime();
        await client.query(
          `select graphile_worker.add_job('latency', json_build_object('id', $1::int))`,
          [id]
        );
        await deferreds[id];
      }
    } finally {
      await client.release();
    }
  }

  await forEmptyQueue(pgPool);

  assert.equal(latencies.length, SAMPLES, "Incorrect latency count");
  // Study the latencies
  const numericLatencies = latencies.map(
    ([seconds, nanoseconds]) => seconds * 1e3 + nanoseconds * 1e-6
  );

  const min = Math.min.apply(Math, numericLatencies);
  const max = Math.max.apply(Math, numericLatencies);
  const average =
    numericLatencies.reduce((sum, next) => sum + next, 0) /
    numericLatencies.length;

  console.log(
    `Latencies - min: ${min.toFixed(2)}ms, max: ${max.toFixed(
      2
    )}ms, avg: ${average.toFixed(2)}ms`
  );

  await workerPool.release();
  await pgPool.end();
  console.log("Done");
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

async function forEmptyQueue(pgPool) {
  let remaining;
  do {
    const {
      rows: [row],
    } = await pgPool.query(
      `select count(*) from graphile_worker.jobs where task_identifier = 'latency'`
    );
    remaining = (row && row.count) || 0;
    sleep(2000);
  } while (remaining > 0);
}
