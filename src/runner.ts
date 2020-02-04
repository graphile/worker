import * as assert from "assert";
import { Pool } from "pg";
import getTasks from "./getTasks";
import { Runner, RunnerOptions, TaskList } from "./interfaces";
import { runTaskList, runTaskListOnce } from "./main";
import { makeWithPgClientFromPool, makeAddJob } from "./helpers";
import { migrate } from "./migrate";
import { defaultLogger, Logger } from "./logger";
import { CONCURRENT_JOBS } from "./config";

type Releasers = Array<() => void | Promise<void>>;

async function assertTaskList(
  options: RunnerOptions,
  releasers: Releasers
): Promise<TaskList> {
  let taskList: TaskList;
  assert(
    !options.taskDirectory || !options.taskList,
    "Exactly one of either `taskDirectory` or `taskList` should be set"
  );
  if (options.taskList) {
    taskList = options.taskList;
  } else if (options.taskDirectory) {
    const watchedTasks = await getTasks(options.taskDirectory, false);
    releasers.push(() => watchedTasks.release());
    taskList = watchedTasks.tasks;
  } else {
    throw new Error(
      "You must specify either `options.taskList` or `options.taskDirectory`"
    );
  }
  return taskList;
}

async function assertPool(
  options: RunnerOptions,
  releasers: Releasers,
  logger: Logger
): Promise<Pool> {
  assert(
    !options.pgPool || !options.connectionString,
    "Both `pgPool` and `connectionString` are set, at most one of these options should be provided"
  );
  let pgPool: Pool;
  if (options.pgPool) {
    pgPool = options.pgPool;
  } else if (options.connectionString) {
    pgPool = new Pool({
      connectionString: options.connectionString,
      max: options.maxPoolSize,
    });
    releasers.push(() => pgPool.end());
  } else if (process.env.DATABASE_URL) {
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: options.maxPoolSize,
    });
    releasers.push(() => pgPool.end());
  } else {
    throw new Error(
      "You must either specify `pgPool` or `connectionString`, or you must make the `DATABASE_URL` environmental variable available."
    );
  }

  pgPool.on("error", err => {
    /*
     * This handler is required so that client connection errors don't bring
     * the server down (via `unhandledError`).
     *
     * `pg` will automatically terminate the client and remove it from the
     * pool, so we don't actually need to take any action here, just ensure
     * that the event listener is registered.
     */
    logger.error(`PostgreSQL client generated error: ${err.message}`, {
      error: err,
    });
  });
  return pgPool;
}

type Release = () => Promise<void>;

async function withReleasers<T>(
  callback: (releasers: Releasers, release: Release) => Promise<T>
): Promise<T> {
  const releasers: Releasers = [];
  const release: Release = async () => {
    await Promise.all(releasers.map(fn => fn()));
  };
  try {
    return await callback(releasers, release);
  } catch (e) {
    try {
      await release();
    } catch (e2) {
      /* noop */
    }
    throw e;
  }
}

const processOptions = async (options: RunnerOptions) => {
  const { logger = defaultLogger, concurrency = CONCURRENT_JOBS } = options;
  return withReleasers(async (releasers, release) => {
    const taskList = await assertTaskList(options, releasers);
    const pgPool: Pool = await assertPool(options, releasers, logger);
    // @ts-ignore
    const max = pgPool?.options?.max || 10;
    if (max < concurrency) {
      console.warn(
        `WARNING: having maxPoolSize (${max}) smaller than concurrency (${concurrency}) may lead to non-optimal performance.`
      );
    }

    const withPgClient = makeWithPgClientFromPool(pgPool);

    // Migrate
    await withPgClient(client => migrate(client));

    return { taskList, pgPool, withPgClient, release, logger };
  });
};

export const runMigrations = async (options: RunnerOptions): Promise<void> => {
  const { logger = defaultLogger } = options;
  return withReleasers(async (releasers, release) => {
    const pgPool: Pool = await assertPool(options, releasers, logger);
    const withPgClient = makeWithPgClientFromPool(pgPool);

    // Migrate
    await withPgClient(client => migrate(client));

    await release();

    return;
  });
};

export const runOnce = async (options: RunnerOptions): Promise<void> => {
  const { taskList, withPgClient, release } = await processOptions(options);
  await withPgClient(client => runTaskListOnce(taskList, client, options));
  await release();
};

export const run = async (options: RunnerOptions): Promise<Runner> => {
  const { taskList, pgPool, withPgClient, release } = await processOptions(
    options
  );

  const workerPool = runTaskList(taskList, pgPool, options);
  let running = true;
  return {
    async stop() {
      if (running) {
        running = false;
        await workerPool.release();
        await release();
      } else {
        throw new Error("Runner is already stopped");
      }
    },
    addJob: makeAddJob(withPgClient),
    promise: workerPool.promise,
  };
};
