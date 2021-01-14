import { EventEmitter } from "events";
import * as pg from "pg";
import { parse } from "pg-connection-string";

import defer from "../src/deferred";
import {
  Job,
  RunnerOptions,
  WorkerPoolOptions,
  WorkerUtils,
} from "../src/interfaces";
import { migrate } from "../src/migrate";

// Sometimes CI's clock can get interrupted (it is shared infra!) so this
// extends the default timeout just in case.
jest.setTimeout(15000);

process.env.GRAPHILE_WORKER_DEBUG = "1";

export const TEST_CONNECTION_STRING =
  process.env.TEST_CONNECTION_STRING || "graphile_worker_test";

const parsed = parse(TEST_CONNECTION_STRING);

export const PGHOST = parsed.host || process.env.PGHOST;
export const PGDATABASE = parsed.database || undefined;

export const GRAPHILE_WORKER_SCHEMA =
  process.env.GRAPHILE_WORKER_SCHEMA || "graphile_worker";
export const ESCAPED_GRAPHILE_WORKER_SCHEMA = pg.Client.prototype.escapeIdentifier(
  GRAPHILE_WORKER_SCHEMA,
);

export async function withPgPool<T>(
  cb: (pool: pg.Pool) => Promise<T>,
): Promise<T> {
  const pool = new pg.Pool({
    connectionString: TEST_CONNECTION_STRING,
  });
  try {
    return await cb(pool);
  } finally {
    pool.end();
  }
}

export async function withPgClient<T>(
  cb: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withPgPool(async (pool) => {
    const client = await pool.connect();
    try {
      return await cb(client);
    } finally {
      client.release();
    }
  });
}

export async function withTransaction<T>(
  cb: (client: pg.PoolClient) => Promise<T>,
  closeCommand = "rollback",
): Promise<T> {
  return withPgClient(async (client) => {
    await client.query("begin");
    try {
      return await cb(client);
    } finally {
      await client.query(closeCommand);
    }
  });
}

function isPoolClient(o: pg.Pool | pg.PoolClient): o is pg.PoolClient {
  return typeof o["release"] === "function";
}

export async function reset(
  pgPoolOrClient: pg.Pool | pg.PoolClient,
  options: WorkerPoolOptions,
) {
  await pgPoolOrClient.query(
    `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
  );
  if (isPoolClient(pgPoolOrClient)) {
    await migrate(options, pgPoolOrClient);
  } else {
    const client = await pgPoolOrClient.connect();
    try {
      await migrate(options, client);
    } finally {
      await client.release();
    }
  }
}

export async function jobCount(
  pgPoolOrClient: pg.Pool | pg.PoolClient,
): Promise<number> {
  const {
    rows: [row],
  } = await pgPoolOrClient.query(
    `select count(*)::int from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs`,
  );
  return row ? row.count || 0 : 0;
}

export function makeMockJob(taskIdentifier: string): Job {
  const createdAt = new Date(Date.now() - 12345678);
  return {
    id: String(Math.floor(Math.random() * 4294967296)),
    queue_name: null,
    task_identifier: taskIdentifier,
    payload: {},
    priority: 0,
    run_at: new Date(Date.now() - Math.random() * 2000),
    attempts: 0,
    max_attempts: 25,
    last_error: null,
    created_at: createdAt,
    updated_at: createdAt,
    locked_at: null,
    locked_by: null,
    revision: 0,
    key: null,
    flags: null,
  };
}

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function sleepUntil(condition: () => boolean, maxDuration = 2000) {
  const start = Date.now();
  // Wait up to a second for the job to be executed
  while (!condition() && Date.now() - start < maxDuration) {
    await sleep(2);
  }
  if (!condition()) {
    throw new Error(
      `Slept for ${Date.now() - start}ms but condition never passed`,
    );
  }
}

export async function makeSelectionOfJobs(
  utils: WorkerUtils,
  pgClient: pg.PoolClient,
) {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  let failedJob = await utils.addJob("job1", { a: 1, runAt: future });
  const regularJob1 = await utils.addJob("job1", { a: 2, runAt: future });
  let lockedJob = await utils.addJob("job1", { a: 3, runAt: future });
  const regularJob2 = await utils.addJob("job1", { a: 4, runAt: future });
  const untouchedJob = await utils.addJob("job1", { a: 5, runAt: future });
  ({
    rows: [lockedJob],
  } = await pgClient.query<Job>(
    `update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs set locked_by = 'test', locked_at = now() where id = $1 returning *`,
    [lockedJob.id],
  ));
  ({
    rows: [failedJob],
  } = await pgClient.query<Job>(
    `update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.jobs set attempts = max_attempts, last_error = 'Failed forever' where id = $1 returning *`,
    [failedJob.id],
  ));

  return {
    failedJob,
    regularJob1,
    lockedJob,
    regularJob2,
    untouchedJob,
  };
}

export class EventAwaiter {
  public events: EventEmitter;

  constructor(eventEmitter = new EventEmitter()) {
    this.events = eventEmitter;
  }

  awaitNext(eventName: string): Promise<void> {
    const d = defer();
    this.events.once(eventName, () => d.resolve());
    return d;
  }
}

export function withOptions<T>(
  callback: (options: RunnerOptions & { pgPool: pg.Pool }) => Promise<T>,
) {
  return withPgPool((pgPool) =>
    callback({
      pgPool,
      taskList: {
        /* DO NOT ADD do_it HERE! */
        do_something_else(payload, helpers) {
          helpers.logger.debug("do_something_else called", { payload });
        },
      },
    }),
  );
}

export function setupFakeTimers() {
  jest.useFakeTimers();

  const originalDateNow = global.Date.now;

  /** The offset, in milliseconds, to apply to results from `Date.now()` */
  let offset = 0;

  /**
   * Sets the `offset` such that a call to `Date.now()` would return this
   * timestamp if called immediately (but time continues to progress as expected
   * after this). Also advances the timers by the difference from the previous
   * `offset`, if positive.
   */
  function setTime(ts: number) {
    const newOffset = ts - originalDateNow.call(global.Date);
    const advancement = newOffset - offset;
    offset = newOffset;
    if (advancement > 0) {
      jest.advanceTimersByTime(advancement);
    }
  }

  beforeEach(() => {
    offset = 0;
    global.Date.now = () => {
      return originalDateNow.call(global.Date) + offset;
    };
  });
  afterEach(() => {
    global.Date.now = originalDateNow;
  });

  return { setTime, realNow: () => originalDateNow.call(global.Date) };
}
