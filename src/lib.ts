import * as assert from "assert";
import { EventEmitter } from "events";
import { Client, Pool, PoolClient } from "pg";

import { defaults } from "./config";
import { makeAddJob, makeWithPgClientFromPool } from "./helpers";
import {
  AddJobFunction,
  RunnerOptions,
  SharedOptions,
  WithPgClient,
  WorkerEvents,
} from "./interfaces";
import { defaultLogger, Logger, LogScope } from "./logger";
import { migrate } from "./migrate";

interface CompiledSharedOptions {
  events: WorkerEvents;
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
  maxContiguousErrors: number;
  useNodeTime: boolean;
}

interface ProcessSharedOptionsSettings {
  scope?: LogScope;
}

const _sharedOptionsCache = new WeakMap<SharedOptions, CompiledSharedOptions>();
export function processSharedOptions(
  options: SharedOptions,
  { scope }: ProcessSharedOptionsSettings = {},
): CompiledSharedOptions {
  let compiled = _sharedOptionsCache.get(options);
  if (!compiled) {
    const {
      logger = defaultLogger,
      schema: workerSchema = defaults.schema,
      events = new EventEmitter(),
      useNodeTime = false,
    } = options;
    const escapedWorkerSchema = Client.prototype.escapeIdentifier(workerSchema);
    compiled = {
      events,
      logger,
      workerSchema,
      escapedWorkerSchema,
      maxContiguousErrors: defaults.maxContiguousErrors,
      useNodeTime,
    };
    _sharedOptionsCache.set(options, compiled);
  }
  if (scope) {
    return {
      ...compiled,
      logger: compiled.logger.scope(scope),
    };
  } else {
    return compiled;
  }
}

export type Releasers = Array<() => void | Promise<void>>;

export async function assertPool(
  options: SharedOptions,
  releasers: Releasers,
): Promise<Pool> {
  const { logger } = processSharedOptions(options);
  assert(
    !options.pgPool || !options.connectionString,
    "Both `pgPool` and `connectionString` are set, at most one of these options should be provided",
  );
  let pgPool: Pool;
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (options.pgPool) {
    pgPool = options.pgPool;
  } else if (connectionString) {
    pgPool = new Pool({
      connectionString,
      max: options.maxPoolSize,
    });
    releasers.push(() => {
      pgPool.end();
    });
  } else if (process.env.PGDATABASE) {
    pgPool = new Pool({
      /* Pool automatically pulls settings from envvars */
      max: options.maxPoolSize,
    });
    releasers.push(() => {
      pgPool.end();
    });
  } else {
    throw new Error(
      "You must either specify `pgPool` or `connectionString`, or you must make the `DATABASE_URL` or `PG*` environmental variables available.",
    );
  }

  const handlePoolError = (err: Error) => {
    /*
     * This handler is required so that client connection errors on clients
     * that are alive but not checked out don't bring the server down (via
     * `unhandledError`).
     *
     * `pg` will automatically terminate the client and remove it from the
     * pool, so we don't actually need to take any action here, just ensure
     * that the event listener is registered.
     */
    logger.error(`PostgreSQL idle client generated error: ${err.message}`, {
      error: err,
    });
  };
  const handleClientError = (err: Error) => {
    /*
     * This handler is required so that client connection errors on clients
     * that are checked out of the pool don't bring the server down (via
     * `unhandledError`).
     *
     * `pg` will automatically raise the error from the client the next time it
     * attempts a query, so we don't actually need to take any action here,
     * just ensure that the event listener is registered.
     */
    logger.error(`PostgreSQL active client generated error: ${err.message}`, {
      error: err,
    });
  };
  pgPool.on("error", handlePoolError);
  const handlePoolConnect = (client: PoolClient) => {
    client.on("error", handleClientError);
  };
  pgPool.on("connect", handlePoolConnect);
  releasers.push(() => {
    pgPool.removeListener("error", handlePoolError);
    pgPool.removeListener("connect", handlePoolConnect);
  });
  return pgPool;
}

export type Release = () => Promise<void>;

export async function withReleasers<T>(
  callback: (releasers: Releasers, release: Release) => Promise<T>,
): Promise<T> {
  const releasers: Releasers = [];
  const release: Release = async () => {
    await Promise.all(releasers.map((fn) => fn()));
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

interface ProcessOptionsExtensions {
  pgPool: Pool;
  withPgClient: WithPgClient;
  addJob: AddJobFunction;
  release: Release;
  releasers: Releasers;
}

export interface CompiledOptions
  extends CompiledSharedOptions,
    ProcessOptionsExtensions {}

export const getUtilsAndReleasersFromOptions = async (
  options: RunnerOptions,
  settings: ProcessSharedOptionsSettings = {},
): Promise<CompiledOptions> => {
  const shared = processSharedOptions(options, settings);
  const { concurrency = defaults.concurrentJobs } = options;
  return withReleasers(
    async (releasers, release): Promise<CompiledOptions> => {
      const pgPool: Pool = await assertPool(options, releasers);
      // @ts-ignore
      const max = pgPool?.options?.max || 10;
      if (max < concurrency) {
        console.warn(
          `WARNING: having maxPoolSize (${max}) smaller than concurrency (${concurrency}) may lead to non-optimal performance.`,
        );
      }

      const withPgClient = makeWithPgClientFromPool(pgPool);

      // Migrate
      await withPgClient((client) => migrate(options, client));
      const addJob = makeAddJob(options, withPgClient);

      return {
        ...shared,
        pgPool,
        withPgClient,
        addJob,
        release,
        releasers,
      };
    },
  );
};
