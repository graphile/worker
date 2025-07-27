import type { PgPool } from "@graphile/pg-core";
import { ident } from "@graphile/pg-core";
import * as assert from "assert";
import EventEmitter from "events";
import {
  applyHooks,
  AsyncHooks,
  Middleware,
  orderedApply,
  resolvePreset,
} from "graphile-config";

import { makeWorkerPresetWorkerOptions } from "./config";
import { migrations } from "./generated/sql";
import { makeAddJob, makeAddJobs, makeWithPgClientFromPool } from "./helpers";
import {
  AddJobFunction,
  AddJobsFunction,
  EnhancedWithPgClient,
  PromiseOrDirect,
  RunnerOptions,
  RunOnceOptions,
  SharedOptions,
  WithPgClient,
  WorkerOptions,
  WorkerPluginBaseContext,
  WorkerPluginContext,
  WorkerSharedOptions,
  WorkerUtilsOptions,
} from "./interfaces";
import { LogScope } from "./logger";
import { migrate } from "./migrate";
import { WorkerPreset } from "./preset";
import { version } from "./version";

const MAX_MIGRATION_NUMBER = Object.keys(migrations).reduce(
  (memo, migrationFile) => {
    const migrationNumber = parseInt(migrationFile.slice(0, 6), 10);
    return Math.max(memo, migrationNumber);
  },
  0,
);

export const BREAKING_MIGRATIONS = Object.entries(migrations)
  .filter(([_, text]) => {
    return text.startsWith("--! breaking");
  })
  .map(([migrationFile]) => parseInt(migrationFile.slice(0, 6), 10));

export type ResolvedWorkerPreset = GraphileConfig.ResolvedPreset & {
  worker: GraphileConfig.WorkerOptions &
    ReturnType<typeof makeWorkerPresetWorkerOptions>;
};

// NOTE: when you add things here, you may also want to add them to WorkerPluginContext
export interface CompiledSharedOptions<T extends SharedOptions = SharedOptions>
  extends WorkerPluginContext {
  /**
   * DO NOT USE THIS! As we move over to presets this will be removed.
   *
   * @internal
   */
  _rawOptions: T;
}

interface ProcessSharedOptionsSettings {
  scope?: LogScope;
}
type SomeOptions = SharedOptions &
  Partial<WorkerSharedOptions> &
  Partial<WorkerOptions> &
  Partial<RunOnceOptions> &
  Partial<WorkerUtilsOptions> &
  Partial<RunnerOptions>;

/**
 * Important: ensure you still handle `forbiddenFlags`, `pgPool`, `workerId`,
 * `autostart`, `workerPool`, `abortSignal`, `noHandleSignals`, `taskList`,
 * `crontab`, `parsedCronItems`!
 */
function legacyOptionsToPreset(options: SomeOptions): GraphileConfig.Preset {
  if ("_rawOptions" in options) {
    console.trace(
      "GraphileWorkerInternalError: CompiledSharedOptions used where SharedOptions was expected.",
    );
    throw new Error(
      "GraphileWorkerInternalError: CompiledSharedOptions used where SharedOptions was expected.",
    );
  }
  assert.ok(
    !options.taskList || !options.taskDirectory,
    "Exactly one of either `taskDirectory` or `taskList` should be set",
  );
  assert.ok(
    !options.pgPool || !options.connectionString,
    "Both `pgPool` and `connectionString` are set, at most one of these options should be provided",
  );
  const preset = {
    extends: [] as GraphileConfig.Preset[],
    worker: {} as Partial<GraphileConfig.WorkerOptions>,
  } satisfies GraphileConfig.Preset;
  for (const key of Object.keys(options) as (keyof SomeOptions)[]) {
    if (options[key] == null) {
      continue;
    }
    switch (key) {
      case "forbiddenFlags":
      case "pgPool":
      case "workerId":
      case "autostart":
      case "workerPool":
      case "abortSignal":
      case "noHandleSignals":
      case "taskList":
      case "crontab":
      case "parsedCronItems": {
        // ignore
        break;
      }
      case "preset": {
        preset.extends.push(options[key]!);
        break;
      }
      case "logger": {
        preset.worker.logger = options[key]!;
        break;
      }
      case "schema": {
        preset.worker.schema = options[key]!;
        break;
      }
      case "connectionString": {
        preset.worker.connectionString = options[key]!;
        break;
      }
      case "events": {
        preset.worker.events = options[key]!;
        break;
      }
      case "maxPoolSize": {
        preset.worker.maxPoolSize = options[key]!;
        break;
      }
      case "useNodeTime": {
        preset.worker.useNodeTime = options[key]!;
        break;
      }
      case "noPreparedStatements": {
        preset.worker.preparedStatements = !options[key]!;
        break;
      }
      case "minResetLockedInterval": {
        preset.worker.minResetLockedInterval = options[key]!;
        break;
      }
      case "maxResetLockedInterval": {
        preset.worker.maxResetLockedInterval = options[key]!;
        break;
      }
      case "gracefulShutdownAbortTimeout": {
        preset.worker.gracefulShutdownAbortTimeout = options[key]!;
        break;
      }
      case "pollInterval": {
        preset.worker.pollInterval = options[key]!;
        break;
      }
      case "concurrency": {
        preset.worker.concurrentJobs = options[key]!;
        break;
      }
      case "taskDirectory": {
        preset.worker.taskDirectory = options[key]!;
        break;
      }
      case "crontabFile": {
        preset.worker.crontabFile = options[key]!;
        break;
      }
      default: {
        const never: never = key;
        console.warn(
          `Do not know how to convert config option '${never}' into its preset equivalent; ignoring.`,
        );
      }
    }
  }
  return preset;
}

const _sharedOptionsCache = new WeakMap<SharedOptions, CompiledSharedOptions>();
export function processSharedOptions<
  T extends
    | SharedOptions
    | WorkerSharedOptions
    | WorkerOptions
    | RunOnceOptions
    | WorkerUtilsOptions,
>(
  options: T,
  { scope }: ProcessSharedOptionsSettings = {},
): CompiledSharedOptions<T> {
  if ("_rawOptions" in options) {
    throw new Error(
      `Fed processed options to processSharedOptions; this is invalid.`,
    );
  }
  let compiled = _sharedOptionsCache.get(options) as
    | CompiledSharedOptions<T>
    | undefined;
  if (!compiled) {
    const resolvedPreset = resolvePreset({
      extends: [
        WorkerPreset,
        // Explicit options override the preset
        legacyOptionsToPreset(options),
      ],
    }) as ResolvedWorkerPreset;

    const middleware = new Middleware<GraphileConfig.WorkerMiddleware>();

    orderedApply(
      resolvedPreset.plugins,
      (plugin) => plugin.worker?.middleware,
      (name, fn, _plugin) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        middleware.register(name, fn as any);
      },
    );

    const {
      worker: {
        minResetLockedInterval,
        maxResetLockedInterval,
        schema: workerSchema,
        logger,
        events = new EventEmitter(),
      },
      plugins,
    } = resolvedPreset;
    const escapedWorkerSchema = ident(workerSchema);

    const ctx: WorkerPluginBaseContext = {
      version,
      resolvedPreset,
      workerSchema,
      escapedWorkerSchema,
      events,
      logger,
    };

    compiled = middleware.run("init", { ctx }, () => {
      if (
        !Number.isFinite(minResetLockedInterval) ||
        !Number.isFinite(maxResetLockedInterval) ||
        minResetLockedInterval < 1 ||
        maxResetLockedInterval < minResetLockedInterval
      ) {
        throw new Error(
          `Invalid values for minResetLockedInterval (${minResetLockedInterval})/maxResetLockedInterval (${maxResetLockedInterval})`,
        );
      }
      const hooks = new AsyncHooks<GraphileConfig.WorkerHooks>();
      const compiled: CompiledSharedOptions<T> = Object.assign(ctx, {
        hooks,
        middleware,
        maxMigrationNumber: MAX_MIGRATION_NUMBER,
        breakingMigrationNumbers: BREAKING_MIGRATIONS,
        _rawOptions: options,
      });
      applyHooks(
        plugins,
        (p) => p.worker?.hooks,
        (name, fn, plugin) => {
          const context: WorkerPluginContext = compiled!;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cb = ((...args: any[]) => fn(context, ...args)) as any;
          cb.displayName = `${plugin.name}_hook_${name}`;
          hooks.hook(name, cb);
        },
      );
      _sharedOptionsCache.set(options, compiled);
      // 'init' hook is deprecated; use middleware instead.
      Promise.resolve(hooks.process("init")).catch((error) => {
        logger.error(
          `One of the plugins you are using raised an error during 'init'; but errors during 'init' are currently ignored. Continuing. Error: ${error}`,
          { error },
        );
      });
      return compiled;
    }) as CompiledSharedOptions<T>;
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
  compiledSharedOptions: CompiledSharedOptions,
  releasers: Releasers,
): Promise<PgPool> {
  const { _rawOptions, resolvedPreset, logger } = compiledSharedOptions;

  let pgPool = _rawOptions.pgPool;
  let shouldReleasePool = false;

  if (!pgPool) {
    // Try to create a pool from connection string or env vars
    const connectionString = resolvedPreset.worker.connectionString;
    const hasPgEnvVars = process.env.PGDATABASE || process.env.DATABASE_URL;

    if (!connectionString && !hasPgEnvVars) {
      throw new Error(
        "You must either specify `pgPool` or `connectionString`, or you must make the `DATABASE_URL` or `PG*` environmental variables available.",
      );
    }

    // Try to dynamically import the adapter
    try {
      const adapterModule = await import("@graphile/pg-adapter-node-postgres");
      const { createNodePostgresPool } = adapterModule;

      // Use connectionString if available, otherwise let pg use env vars
      pgPool = createNodePostgresPool(
        connectionString ? { connectionString } : {},
      );
      shouldReleasePool = true;

      logger.debug(
        "Created PgPool using @graphile/pg-adapter-node-postgres. Consider creating the pool yourself for better control.",
      );
    } catch (error) {
      throw new Error(
        "A PgPool instance must be provided via the 'pgPool' option. To use a connection string, please install '@graphile/pg-adapter-node-postgres' and 'pg' packages.",
      );
    }
  }

  // Only register cleanup if we created the pool
  if (shouldReleasePool && pgPool) {
    releasers.push(() => pgPool!.end());
  }

  if (!pgPool) {
    throw new Error("Failed to create or obtain pgPool");
  }

  return pgPool;
}

export type Release = () => PromiseOrDirect<void>;

export async function withReleasers<T>(
  callback: (releasers: Releasers, release: Release) => Promise<T>,
): Promise<T> {
  const releasers: Releasers = [];
  let released = false;
  const release: Release = async () => {
    if (released) {
      throw new Error(`Internal error: compiledOptions was released twice.`);
    } else {
      released = true;
    }
    let firstError: Error | null = null;
    // Call releasers in reverse order - LIFO queue.
    for (let i = releasers.length - 1; i >= 0; i--) {
      try {
        await releasers[i]();
      } catch (e) {
        firstError ??= coerceError(e);
      }
    }
    if (firstError) {
      throw firstError;
    }
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
  pgPool: PgPool;
  withPgClient: EnhancedWithPgClient;
  addJob: AddJobFunction;
  addJobs: AddJobsFunction;
  releasers: Releasers;
}

export interface CompiledOptions
  extends CompiledSharedOptions<RunnerOptions>,
    ProcessOptionsExtensions {}

type CompiledOptionsAndRelease = [
  compiledOptions: CompiledOptions,
  release: (error?: Error) => PromiseOrDirect<void>,
];

export const getUtilsAndReleasersFromOptions = async (
  options: RunnerOptions,
  settings: ProcessSharedOptionsSettings = {},
): Promise<CompiledOptionsAndRelease> => {
  if ("_rawOptions" in options) {
    throw new Error(
      `Fed processed options to getUtilsAndReleasersFromOptions; this is invalid.`,
    );
  }
  const compiledSharedOptions = processSharedOptions(options, settings);
  const {
    logger,
    resolvedPreset: {
      worker: { concurrentJobs: concurrency },
    },
  } = compiledSharedOptions;
  return withReleasers(async function getUtilsFromOptions(
    releasers,
    release,
  ): Promise<CompiledOptionsAndRelease> {
    const pgPool: PgPool = await assertPool(compiledSharedOptions, releasers);
    const poolSize = pgPool.getPoolSize();
    if (poolSize < concurrency) {
      logger.warn(
        `WARNING: having pool size (${poolSize}) smaller than concurrency (${concurrency}) may lead to non-optimal performance.`,
        { poolSize, concurrency },
      );
    }

    const withPgClient = makeEnhancedWithPgClient(
      makeWithPgClientFromPool(pgPool),
    );

    // Migrate
    await withPgClient(function migrateWithPgClient(client) {
      return migrate(compiledSharedOptions, client);
    });

    const addJob = makeAddJob(compiledSharedOptions, withPgClient);
    const addJobs = makeAddJobs(compiledSharedOptions, withPgClient);

    return [
      {
        ...compiledSharedOptions,
        pgPool,
        withPgClient,
        addJob,
        addJobs,
        releasers,
      },
      release,
    ];
  });
};

export function tryParseJson<T = object>(
  json: string | null | undefined,
): T | null {
  if (json == null) {
    return null;
  }
  try {
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

/** @see {@link https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html} */
export const RETRYABLE_ERROR_CODES: Record<
  string,
  Omit<RetryOptions, "maxAttempts" | "multiplier"> | undefined
> = {
  // @ts-ignore
  __proto__: null,

  "40001": { minDelay: 50, maxDelay: 5_000 }, // serialization_failure
  "40P01": { minDelay: 50, maxDelay: 5_000 }, // deadlock_detected
  "57P03": { minDelay: 3000, maxDelay: 120_000 }, // cannot_connect_now
  EHOSTUNREACH: { minDelay: 3000, maxDelay: 120_000 }, // no connection to the server
  ETIMEDOUT: { minDelay: 3000, maxDelay: 120_000 }, // timeout
};

const MAX_RETRIES = 100;

export function makeEnhancedWithPgClient(
  withPgClient: WithPgClient | EnhancedWithPgClient,
): EnhancedWithPgClient {
  if (
    "withRetries" in withPgClient &&
    typeof withPgClient.withRetries === "function"
  ) {
    return withPgClient;
  }
  const enhancedWithPgClient = withPgClient as EnhancedWithPgClient;
  enhancedWithPgClient.withRetries = async (...args) => {
    let lastError!: Error;
    for (let attempts = 0; attempts < MAX_RETRIES; attempts++) {
      try {
        return await withPgClient(...args);
      } catch (rawE) {
        const e = coerceError(rawE);
        const retryable = RETRYABLE_ERROR_CODES[e.code as string];
        if (retryable) {
          lastError = e;
          const delay = calculateDelay(attempts, {
            maxAttempts: MAX_RETRIES,
            minDelay: retryable.minDelay,
            maxDelay: retryable.maxDelay,
            multiplier: 1.5,
          });
          // Try again in backoffMS
          await sleep(delay);
        } else {
          throw e;
        }
      }
    }
    console.error(`Retried ${MAX_RETRIES} times, and still failed:`, lastError);
    throw lastError;
  };
  return enhancedWithPgClient;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function coerceError(err: unknown): Error & { code?: unknown } {
  if (err instanceof Error) {
    return err;
  } else {
    const message =
      typeof err === "object" && err !== null && "message" in err
        ? String(err.message)
        : "An error occurred";
    return new Error(message, { cause: err });
  }
}

export function isPromiseLike<T>(v: PromiseLike<T> | T): v is PromiseLike<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return v != null && typeof (v as any).then === "function";
}

export interface RetryOptions {
  maxAttempts: number;
  /** Minimum delay between attempts (milliseconds); can actually be half this due to jitter */
  minDelay: number;
  /** Maximum delay between attempts (milliseconds) - can actually be 1.5x this due to jitter */
  maxDelay: number;
  /** `multiplier ^ attempts` */
  multiplier: number;
}

export function calculateDelay(
  previousAttempts: number,
  retryOptions: RetryOptions,
) {
  const { minDelay = 200, maxDelay = 30_000, multiplier = 1.5 } = retryOptions;
  /** Prevent the thundering herd problem by offsetting randomly */
  const jitter = Math.random();

  return (
    Math.min(minDelay * Math.pow(multiplier, previousAttempts), maxDelay) *
    (0.5 + jitter)
  );
}
