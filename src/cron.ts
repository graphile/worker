import * as assert from "assert";
import { promises as fsp } from "fs";
import { Pool } from "pg";

import { parseCrontab } from "./crontab";
import defer from "./deferred";
import {
  AddJobFunction,
  CronItem,
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

export const runCron = (
  options: RunnerOptions,
  cronItems: CronItem[],
  { pgPool, addJob, events }: CronRequirements,
): Cron => {
  // TODO: events
  const promise = defer();
  let stopped = false;

  (async () => {
    // TODO HERE!
    // First, scan the DB to get our starting point.
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
    const crontab = await fsp.readFile(crontabFile, "utf8");
    return parseCrontab(crontab);
  } else {
    assert(cronItems != null, "Expected `cronItems` to be set.");
    return cronItems;
  }
}
