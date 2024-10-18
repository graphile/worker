import { randomBytes } from "crypto";
import { EventEmitter } from "events";
import * as pg from "pg";
import { parse } from "pg-connection-string";

import defer from "../src/deferred";
import {
  DbJob,
  Job,
  KnownCrontab,
  RunnerOptions,
  WorkerEventMap,
  WorkerPoolOptions,
  WorkerUtils,
} from "../src/interfaces";
import { processSharedOptions } from "../src/lib";
import { _allWorkerPools } from "../src/main";
import { migrate } from "../src/migrate";

declare global {
  namespace GraphileWorker {
    interface Tasks {
      job1: { id: string };
      job2: { id: string };
    }
  }
}

export {
  DAY,
  HOUR,
  MINUTE,
  SECOND,
  setupFakeTimers,
  sleep,
  sleepUntil,
  WEEK,
} from "jest-time-helpers";

// Sometimes CI's clock can get interrupted (it is shared infra!) so this
// extends the default timeout just in case.
jest.setTimeout(15000);

// process.env.GRAPHILE_LOGGER_DEBUG = "1";

async function createTestDatabase() {
  const id = randomBytes(8).toString("hex");
  const PGDATABASE = `graphile_worker_test_${id}`;
  {
    const client = new pg.Client({ connectionString: `postgres:///template1` });
    await client.connect();
    await client.query(
      `create database ${pg.Client.prototype.escapeIdentifier(
        PGDATABASE,
      )} with template = graphile_worker_testtemplate;`,
    );
    await client.end();
  }
  const TEST_CONNECTION_STRING = `postgres:///${PGDATABASE}`;
  const PGHOST = process.env.PGHOST;
  async function release() {
    const client = new pg.Client({ connectionString: `postgres:///template1` });
    await client.connect();
    await client.query(
      `drop database ${pg.Client.prototype.escapeIdentifier(PGDATABASE)};`,
    );
    await client.end();
  }

  return {
    TEST_CONNECTION_STRING,
    PGHOST,
    PGDATABASE,
    release,
  };
}

export let databaseDetails: Awaited<
  ReturnType<typeof createTestDatabase>
> | null = null;

beforeAll(async () => {
  databaseDetails = await createTestDatabase();
});
afterAll(async () => {
  databaseDetails?.release();
});

export const GRAPHILE_WORKER_SCHEMA =
  process.env.GRAPHILE_WORKER_SCHEMA || "graphile_worker";
export const ESCAPED_GRAPHILE_WORKER_SCHEMA =
  pg.Client.prototype.escapeIdentifier(GRAPHILE_WORKER_SCHEMA);

export async function withPgPool<T>(
  cb: (pool: pg.Pool) => Promise<T>,
): Promise<T> {
  const { TEST_CONNECTION_STRING } = databaseDetails!;
  const pool = new pg.Pool({
    connectionString: TEST_CONNECTION_STRING,
  });
  try {
    return await cb(pool);
  } finally {
    pool.end();
  }
}

afterEach(() => {
  if (_allWorkerPools.length !== 0) {
    throw new Error(`Current test failed to release all workers`);
  }
});

export async function withPgClient<T>(
  cb: (
    client: pg.PoolClient,
    extra: {
      TEST_CONNECTION_STRING: string;
    },
  ) => Promise<T>,
): Promise<T> {
  return withPgPool(async (pool) => {
    const client = await pool.connect();
    try {
      return await cb(client, databaseDetails!);
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
  return "release" in o && typeof o.release === "function";
}

export async function reset(
  pgPoolOrClient: pg.Pool | pg.PoolClient,
  options: WorkerPoolOptions,
) {
  await pgPoolOrClient.query(
    `drop schema if exists ${ESCAPED_GRAPHILE_WORKER_SCHEMA} cascade;`,
  );
  const compiledSharedOptions = processSharedOptions(options);
  if (isPoolClient(pgPoolOrClient)) {
    await migrate(compiledSharedOptions, pgPoolOrClient);
  } else {
    const client = await pgPoolOrClient.connect();
    try {
      await migrate(compiledSharedOptions, client);
    } finally {
      client.release();
    }
  }
}

export async function jobCount(
  pgPoolOrClient: pg.Pool | pg.PoolClient,
): Promise<number> {
  const {
    rows: [row],
  } = await pgPoolOrClient.query(
    `select count(*)::int from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs`,
  );
  return row ? row.count || 0 : 0;
}

export async function getKnown(pgPool: pg.Pool) {
  const { rows } = await pgPool.query<KnownCrontab>(
    `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_known_crontabs as known_crontabs`,
  );
  return rows;
}

export async function getJobs(
  pgClient: pg.Pool | pg.PoolClient,
  extra: {
    where?: string;
    values?: any[];
  } = {},
) {
  const { where, values } = extra;
  const { rows } = await pgClient.query<
    Job & { queue_name: string; payload: any }
  >(
    `\
select
  jobs.*,
  identifier as task_identifier,
  job_queues.queue_name as queue_name
from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs
left join ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_tasks as tasks
on (tasks.id = jobs.task_id)
left join ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues as job_queues
on (job_queues.id = jobs.job_queue_id)
${where ? `where ${where}\n` : ""}\
order by jobs.id asc`,
    values,
  );
  return rows;
}

export async function getJobQueues(pgClient: pg.Pool | pg.PoolClient) {
  const { rows } = await pgClient.query<{
    id: number;
    queue_name: string;
    job_count: number;
    locked_at: Date;
    locked_by: string;
  }>(
    `\
select job_queues.*, count(jobs.*)::int as job_count
from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_job_queues as job_queues
left join ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs on (
  jobs.job_queue_id = job_queues.id
)
group by job_queues.id
order by job_queues.queue_name asc`,
  );
  return rows;
}

export function makeMockJob(taskIdentifier: string): Job {
  const createdAt = new Date(Date.now() - 12345678);
  return {
    id: String(Math.floor(Math.random() * 4294967296)),
    job_queue_id: null,
    task_id: 123456789,
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
    is_available: true,
  };
}

export async function makeSelectionOfJobs(
  utils: WorkerUtils,
  pgClient: pg.PoolClient,
) {
  const future = new Date(Date.now() + 60 * 60 * 1000);
  const failedJob: DbJob = await utils.addJob("job3", { a: 1, runAt: future });
  const regularJob1 = await utils.addJob("job3", { a: 2, runAt: future });
  const lockedJob: DbJob = await utils.addJob("job3", { a: 3, runAt: future });
  const regularJob2 = await utils.addJob("job3", { a: 4, runAt: future });
  const untouchedJob = await utils.addJob("job3", { a: 5, runAt: future });
  const {
    rows: [lockedJobUpdate],
  } = await pgClient.query<DbJob>(
    `update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs set locked_by = 'test', locked_at = now() where id = $1 returning *`,
    [lockedJob.id],
  );
  Object.assign(lockedJob, lockedJobUpdate);
  const {
    rows: [failedJobUpdate],
  } = await pgClient.query<DbJob>(
    `update ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs as jobs set attempts = max_attempts, last_error = 'Failed forever' where id = $1 returning *`,
    [failedJob.id],
  );
  Object.assign(failedJob, failedJobUpdate);

  return {
    failedJob,
    regularJob1,
    lockedJob,
    regularJob2,
    untouchedJob,
  };
}

interface EventCounter<TEventName extends keyof WorkerEventMap> {
  count: number;
  lastEvent: null | WorkerEventMap[TEventName];
}

export class EventMonitor {
  public events: EventEmitter;

  constructor(eventEmitter = new EventEmitter()) {
    this.events = eventEmitter;
  }

  awaitNext(eventName: keyof WorkerEventMap): Promise<void> {
    const d = defer();
    this.events.once(eventName, () => d.resolve());
    return d;
  }

  count<TEventName extends keyof WorkerEventMap>(
    eventName: TEventName,
  ): EventCounter<TEventName> {
    const counter: EventCounter<TEventName> = { count: 0, lastEvent: null };
    this.events.on(eventName, (payload) => {
      counter.count++;
      counter.lastEvent = payload;
    });
    return counter;
  }

  release() {}
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
