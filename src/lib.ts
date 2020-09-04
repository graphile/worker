import * as assert from "assert";
import { Client, Pool } from "pg";

import { defaults } from "./config";
import { makeAddJob, makeWithPgClientFromPool } from "./helpers";
import {
  AddJobFunction,
  RunnerOptions,
  SharedOptions,
  WithPgClient,
} from "./interfaces";
import { defaultLogger, Logger, LogScope } from "./logger";
import { migrate } from "./migrate";

interface CompiledSharedOptions {
  logger: Logger;
  workerSchema: string;
  escapedWorkerSchema: string;
  maxContiguousErrors: number;
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
    } = options;
    const escapedWorkerSchema = Client.prototype.escapeIdentifier(workerSchema);
    compiled = {
      logger,
      workerSchema,
      escapedWorkerSchema,
      maxContiguousErrors: defaults.maxContiguousErrors,
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

/**
 * Builds a connection string from the `PG*` or `DATABASE_URL` envvars.
 *
 * @remarks
 * In future we should rely on the `pg` module to correctly interperet these
 * envvars; but since our internals rely on manipulation of the connection
 * string (and this is also required for passing the connection string down to
 * child processes, e.g. from the hooks) for now we'll do best efforts
 * connection string construction from the envvars.
 */
export function connectionStringFromEnvvars() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  } else if (process.env.PGHOST && process.env.PGDATABASE) {
    const {
      PGHOST,
      PGPORT,
      PGDATABASE,
      PGUSER,
      PGPASSWORD,
      PGAPPNAME,
      PGCLIENTENCODING,
      PGSSLMODE,
      PGREQUIRESSL,
      PGSSLCERT,
      PGSSLKEY,
      PGSSLROOTCERT,
    } = process.env;
    let str = "postgres://";
    if (PGUSER) {
      str += encodeURIComponent(PGUSER);
    }
    if (PGPASSWORD) {
      str += ":" + encodeURIComponent(PGPASSWORD);
    }
    if (PGUSER || PGPASSWORD) {
      str += "@";
    }
    if (PGHOST && !PGHOST.startsWith("/")) {
      str += PGHOST;
    }
    if (PGPORT) {
      str += ":" + PGPORT;
    }
    str += "/";
    str += PGDATABASE;
    let sep = "?";
    const q = (
      key: string,
      val: string | null | undefined | boolean,
    ): string => {
      if (val != null) {
        const str =
          sep +
          encodeURIComponent(key) +
          "=" +
          encodeURIComponent(val === true ? "1" : val === false ? "0" : val);
        if (sep === "?") {
          sep = "&";
        }
        return str;
      }
      return "";
    };
    if (PGHOST && PGHOST.startsWith("/")) {
      str += q("host", PGHOST);
    }
    str += q(
      "ssl",
      ["1", "true"].includes(PGREQUIRESSL || "") ||
        ["allow", "prefer", "require", "verify-ca", "verify-full"].includes(
          PGSSLMODE || "",
        ),
    );
    str += q("client_encoding", PGCLIENTENCODING);
    str += q("application_name", PGAPPNAME);
    str += q("sslcert", PGSSLCERT);
    str += q("sslkey", PGSSLKEY);
    str += q("sslrootcert", PGSSLROOTCERT);
    return str;
  } else {
    return undefined;
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
  const connectionString =
    options.connectionString || connectionStringFromEnvvars();
  if (options.pgPool) {
    pgPool = options.pgPool;
  } else if (connectionString) {
    pgPool = new Pool({
      connectionString,
      max: options.maxPoolSize,
    });
    releasers.push(() => pgPool.end());
  } else {
    throw new Error(
      "You must either specify `pgPool` or `connectionString`, or you must make the `DATABASE_URL` or `PG*` environmental variables available.",
    );
  }

  pgPool.on("error", (err) => {
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
