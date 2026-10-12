import { EventEmitter } from "events";
import type { Pool, PoolClient } from "pg";

import type {
  TaskList,
  WorkerEventMap,
  WorkerSharedOptions,
} from "../src/interfaces.ts";
import { Logger } from "../src/logger.ts";
import { runTaskList } from "../src/main.ts";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  reset,
  sleepUntil,
  withPgPool,
} from "./helpers.ts";

const addJob = (pgPool: Pool) =>
  pgPool.query(
    `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', '1'), 'serial')`,
  );

const options: WorkerSharedOptions = {};

/**
 * Intercepts clients acquired from `pgPool` and makes the first query whose
 * text satisfies `shouldFail` reject with an error that `withRetries` will
 * not retry (one without a `code`), like a dropped connection.
 */
function failNextMatchingQuery(
  pgPool: Pool,
  shouldFail: (text: string) => boolean,
) {
  const originalConnect = pgPool.connect;
  let triggered = false;
  const wrapped = new WeakSet<PoolClient>();

  const wrapClient = (client: PoolClient) => {
    if (wrapped.has(client)) {
      return client;
    }
    wrapped.add(client);
    const originalQuery = client.query as (...args: any[]) => any;
    client.query = ((config: any, ...rest: any[]) => {
      const text =
        typeof config === "string" ? config : (config?.text as string);
      if (!triggered && typeof text === "string" && shouldFail(text)) {
        triggered = true;
        return Promise.reject(new Error("Connection terminated unexpectedly"));
      }
      return originalQuery.call(client, config, ...rest);
    }) as any;
    return client;
  };

  pgPool.connect = ((
    cb?: (
      err: Error | undefined,
      client?: PoolClient,
      release?: (releaseErr?: Error | boolean) => void,
    ) => void,
  ) => {
    const promise = (originalConnect as () => Promise<PoolClient>)
      .call(pgPool)
      .then(wrapClient);
    if (typeof cb === "function") {
      promise.then(
        (client) => cb(undefined, client, (err) => client.release(err)),
        (err: Error) => cb(err),
      );
      return;
    }
    return promise;
  }) as any;
  return () => {
    pgPool.connect = originalConnect;
  };
}

test.each([
  [
    "completeJob",
    false,
    (text: string) =>
      /delete\s+from/i.test(text) && text.includes("_private_jobs"),
  ],
  [
    "failJob",
    true,
    (text: string) =>
      text.includes("last_error") && text.includes("_private_jobs"),
  ],
])(
  "unbatched %s failing to record the job outcome is handled like the batched path",
  (action, taskShouldFail, shouldFail) =>
    withPgPool(async (pgPool) => {
      await reset(pgPool, options);

      const loggedErrors: string[] = [];
      const logger = new Logger(() => (level, message) => {
        if (level === "error") {
          loggedErrors.push(message);
        }
      });

      const events = new EventEmitter();
      const fatalErrors: Array<WorkerEventMap["pool:fatalError"]> = [];
      events.on("pool:fatalError", (event) => {
        fatalErrors.push(event);
      });

      const restore = failNextMatchingQuery(pgPool, shouldFail);

      const tasks: TaskList = {
        job1() {
          if (taskShouldFail) {
            throw new Error("Task failed");
          }
        },
      };

      const workerPool = runTaskList(
        { concurrency: 1, events, logger },
        tasks,
        pgPool,
      );
      // Attach handlers immediately so that a rejection of workerPool.promise
      // is itself handled.
      const finished = workerPool.promise.then(
        () => ({ resolved: true as const }),
        (error: unknown) => ({ resolved: false as const, error }),
      );
      try {
        await addJob(pgPool);
        await sleepUntil(() => fatalErrors.length > 0);

        expect(fatalErrors).toHaveLength(1);
        expect(fatalErrors[0].action).toEqual(action);
        expect(fatalErrors[0].error).toBeInstanceOf(Error);
        expect(
          loggedErrors.some((message) =>
            message.includes(
              action === "completeJob"
                ? "Failed to complete jobs '1'"
                : "Failed to fail jobs '1'",
            ),
          ),
        ).toBe(true);
        await expect(finished).resolves.toEqual({
          resolved: false,
          error: expect.objectContaining({
            message: "Connection terminated unexpectedly",
          }),
        });
      } finally {
        await Promise.resolve(workerPool.gracefulShutdown()).catch(() => {});
        await finished;
        restore();
      }
    }),
);
