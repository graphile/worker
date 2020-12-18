import * as assert from "assert";
import { Pool } from "pg";

import { parseCrontab } from "./crontab";
import defer from "./deferred";
import getCronItems from "./getCronItems";
import {
  AddJobFunction,
  CronItem,
  KnownCrontab,
  RunnerOptions,
  WorkerEvents,
} from "./interfaces";
import { Releasers } from "./lib";

export interface Cron {
  release(): Promise<void>;
  promise: Promise<void>;
}

interface CronRequirements {
  pgPool: Pool;
  addJob: AddJobFunction;
  events: WorkerEvents;
}

/**
 * Executes our scheduled jobs as required.
 *
 * @param options - the common options
 * @param cronItems - MUTABLE list of cron items to monitor. Do not assume this is static.
 */
export const runCron = (
  options: RunnerOptions,
  cronItems: CronItem[],
  { pgPool, addJob }: CronRequirements,
): Cron => {
  const { logger, escapedWorkerSchema, events } = processSharedOptions(options);
  // TODO: events
  const promise = defer();
  let stopped = false;

  (async () => {
    // TODO HERE!
    // First, scan the DB to get our starting point.
    const { rows } = await pgPool.query<KnownCrontab>(
      `SELECT * FROM ${escapedWorkerSchema}.known_crontabs`,
    );

    // Then, if any jobs are overdue, trigger them.
    // Then set up schedule to run jobs in future.
    // All the while, if stopped, abort.
  })().catch((e) => {
    stopped = true;
    promise.reject(e);
  });

  return {
    release() {
      if (!stopped) {
        stopped = true;
      }
      return promise;
    },
    promise,
  };
};

export async function assertCronItems(
  options: RunnerOptions,
  releasers: Releasers,
): Promise<Array<CronItem>> {
  const { crontabFile, cronItems, crontab } = options;

  if (!crontabFile && !cronItems && !crontab) {
    return [];
  }

  if (crontab) {
    assert(
      !crontabFile,
      "`crontab` and `crontabFile` must not be set at the same time.",
    );
    assert(
      !cronItems,
      "`crontab` and `crontabFile` must not be set at the same time.",
    );

    return parseCrontab(crontab);
  } else if (crontabFile) {
    assert(
      !cronItems,
      "`crontab` and `crontabFile` must not be set at the same time.",
    );

    const watchedCronItems = await getCronItems(options, crontabFile, false);
    releasers.push(() => watchedCronItems.release());
    return watchedCronItems.items;
  } else {
    assert(cronItems != null, "Expected `cronItems` to be set.");

    return cronItems;
  }
}
