import { createNodePostgresPool } from "@graphile/pg-adapter-node-postgres";
import type { PgPool } from "@graphile/pg-core";

import { DbJobSpec, Runner, RunnerOptions } from "../src/interfaces";
import { run } from "../src/runner";
import {
  databaseDetails,
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  sleepUntil,
  withPgClient,
} from "./helpers";

let pgPool!: PgPool;
let runner: Runner | null = null;

const JOB_COUNT = 10;
beforeAll(async () => {
  pgPool = createNodePostgresPool({
    connectionString: databaseDetails!.TEST_CONNECTION_STRING,
    max: JOB_COUNT * 2 + 5,
  });
});
afterAll(async () => {
  await pgPool.end();
});

afterEach(async () => {
  if (runner) {
    await runner.stop();
    runner = null;
  }
});

test("getTaskName works as expected", async () => {
  let results: Record<string, string | null> = Object.create(null);

  const options: RunnerOptions = {
    pgPool,
    maxPoolSize: JOB_COUNT * 2 + 5,
    concurrency: JOB_COUNT * 2,
    taskList: {
      async job1(payload, helpers) {
        const queueNamePromise = helpers.getQueueName();
        const queueName = await queueNamePromise;
        results[payload.id] =
          typeof queueNamePromise === "string" || queueName === null
            ? `CACHE<${queueName}>`
            : `FETCH<${queueName}>`;
      },
    },
  };
  runner = await run(options);

  // Warmup pool
  {
    const promises: Promise<void>[] = [];
    for (let i = 0; i < JOB_COUNT * 2 + 1; i++) {
      promises.push(
        pgPool.withPgClient(async () => {
          // Just connect and immediately release
        }),
      );
    }
    await Promise.all(promises);
  }

  // First set of tests
  {
    const jobSpecs: DbJobSpec[] = [];
    for (let i = 1; i <= JOB_COUNT; i++) {
      jobSpecs.push({
        identifier: "job1",
        payload: { id: `j${i}` },
        queue_name: `q${i % 7}`,
        run_at: new Date(
          Date.now() - (JOB_COUNT - i) * 60 * 1000,
        ).toISOString(),
      });
    }
    await withPgClient((client) =>
      client.execute(
        `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_jobs((select array_agg(r) from json_populate_recordset(null::${ESCAPED_GRAPHILE_WORKER_SCHEMA}.job_spec, $1::json) r))`,
        [JSON.stringify(jobSpecs)],
      ),
    );
  }
  await sleepUntil(() => Object.keys(results).length === JOB_COUNT);
  expect(results).toEqual({
    j1: "FETCH<q1>",
    j2: "FETCH<q2>",
    j3: "FETCH<q3>",
    j4: "FETCH<q4>",
    j5: "FETCH<q5>",
    j6: "FETCH<q6>",
    j7: "FETCH<q0>",
    // Same queue as before, so runs later
    j8: "CACHE<q1>",
    j9: "CACHE<q2>",
    j10: "CACHE<q3>",
  });

  // Do it again; shouldn't need a DB lookup
  results = Object.create(null);
  {
    const jobSpecs: DbJobSpec[] = [];
    for (let i = 1; i <= JOB_COUNT; i++) {
      jobSpecs.push({
        identifier: "job1",
        payload: { id: `j${i}` },
        queue_name: `q${i % 7}`,
        run_at: new Date(
          Date.now() - (JOB_COUNT - i) * 60 * 1000,
        ).toISOString(),
      });
    }
    await withPgClient((client) =>
      client.execute(
        `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_jobs((select array_agg(r) from json_populate_recordset(null::${ESCAPED_GRAPHILE_WORKER_SCHEMA}.job_spec, $1::json) r))`,
        [JSON.stringify(jobSpecs)],
      ),
    );
  }
  await sleepUntil(() => Object.keys(results).length === JOB_COUNT);
  expect(results).toEqual({
    // All of these are already known
    j1: "CACHE<q1>",
    j2: "CACHE<q2>",
    j3: "CACHE<q3>",
    j4: "CACHE<q4>",
    j5: "CACHE<q5>",
    j6: "CACHE<q6>",
    j7: "CACHE<q0>",
    j8: "CACHE<q1>",
    j9: "CACHE<q2>",
    j10: "CACHE<q3>",
  });

  // Mixture of old and new queues
  results = Object.create(null);
  {
    const jobSpecs: DbJobSpec[] = [];
    for (let i = 1; i <= JOB_COUNT; i++) {
      jobSpecs.push({
        identifier: "job1",
        payload: { id: `j${i}` },
        queue_name: `q${(i % 7) + 5}`,
        run_at: new Date(
          Date.now() - (JOB_COUNT - i) * 60 * 1000,
        ).toISOString(),
      });
    }
    await withPgClient((client) =>
      client.execute(
        `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_jobs((select array_agg(r) from json_populate_recordset(null::${ESCAPED_GRAPHILE_WORKER_SCHEMA}.job_spec, $1::json) r))`,
        [JSON.stringify(jobSpecs)],
      ),
    );
  }
  await sleepUntil(() => Object.keys(results).length === JOB_COUNT);
  expect(results).toEqual({
    // Already known
    j1: "CACHE<q6>",
    // New
    j2: "FETCH<q7>",
    j3: "FETCH<q8>",
    j4: "FETCH<q9>",
    j5: "FETCH<q10>",
    j6: "FETCH<q11>",
    // Already known
    j7: "CACHE<q5>",
    j8: "CACHE<q6>",
    // Same queue, so runs later
    j9: "CACHE<q7>",
    j10: "CACHE<q8>",
  });
});
