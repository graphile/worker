import * as assert from "assert";
import { Pool } from "pg";

import { parseCrontab } from "./crontab";
import defer from "./deferred";
import getCronItems from "./getCronItems";
import {
  CronItem,
  KnownCrontab,
  RunnerOptions,
  WorkerEvents,
} from "./interfaces";
import { processSharedOptions, Releasers } from "./lib";

export interface Cron {
  release(): Promise<void>;
  promise: Promise<void>;
}

interface CronRequirements {
  pgPool: Pool;
  events: WorkerEvents;
}

function getBackfillAndUnknownItems(
  cronItems: CronItem[],
  knownCrontabs: KnownCrontab[],
) {
  const backfillItemsAndDates: Array<{ item: CronItem; notBefore: Date }> = [];
  const unknownIdentifiers: string[] = [];
  for (const item of cronItems) {
    const known = knownCrontabs.find(
      (record) => record.identifier === item.identifier,
    );
    if (known) {
      // We only back-fill for tasks we already know about
      const notBefore = known.last_execution || known.known_since;
      backfillItemsAndDates.push({
        item,
        notBefore,
      });
    } else {
      unknownIdentifiers.push(item.identifier);
    }
  }
  return { backfillItemsAndDates, unknownIdentifiers };
}

/** WARNING: mutates input date */
function roundToMinute(ts: Date, roundUp = false): Date {
  if (ts.getUTCSeconds() > 0 || ts.getUTCMilliseconds() > 0) {
    ts.setUTCSeconds(0);
    ts.setUTCMilliseconds(0);
    if (roundUp) {
      ts.setUTCMinutes(ts.getUTCMinutes() + 1);
    }
  }
  return ts;
}

/** Spec for a job created from cron */
interface CronJob {
  task: string;
  payload: {
    _cron: { ts: string; backfilled?: boolean };
    [key: string]: unknown;
  };
  queueName?: string;
  runAt: string;
  maxAttempts?: number;
  priority?: number;
}

function makeJobForItem(
  item: CronItem,
  ts: string,
  backfilled = false,
): CronJob {
  return {
    task: item.task,
    payload: {
      ...item.payload,
      _cron: {
        ts,
        backfilled,
      },
    },
    queueName: item.options.queueName,
    runAt: ts,
    maxAttempts: item.options.maxAttempts,
    priority: item.options.priority,
  };
}

interface JobAndIdentifier {
  job: CronJob;
  identifier: string;
}

async function executeCronJobs(
  pgPool: Pool,
  escapedWorkerSchema: string,
  jobsAndIdentifiers: JobAndIdentifier[],
  ts: string,
) {
  // Note that `identifier` is guaranteed to be unique for every record
  // in `specs`.
  await pgPool.query(
    `
      with specs as (
        select
          index,
          (json->>'identifier')::text as identifier,
          ((json->'job')->>'task')::text as task,
          ((json->'job')->'payload')::json as payload,
          ((json->'job')->>'queueName')::text as queue_name,
          ((json->'job')->>'runAt')::timestamptz as run_at,
          ((json->'job')->>'maxAttempts')::int as max_attempts,
          ((json->'job')->>'priority')::int as priority
        from json_array_elements($1::json) with ordinality AS entries (json, index)
      ),
      locks as (
        insert into ${escapedWorkerSchema}.known_crontabs (identifier, last_execution)
        select
          specs.identifier,
          $2 as last_execution
        from specs
        on conflict (identifier)
        do update set last_execution = excluded.last_execution
        where coalesce(known_crontabs.last_execution, known_crontabs.known_since) < excluded.last_execution
        returning known_crontabs.identifier
      )
      select
        ${escapedWorkerSchema}.add_job(
          specs.task,
          specs.payload,
          specs.queue_name,
          specs.run_at,
          specs.max_attempts,
          null,
          specs.priority
        )
      from specs
      inner join locks on (locks.identifier = specs.identifier)
      order by specs.index asc
    `,
    [JSON.stringify(jobsAndIdentifiers), ts],
  );
}

async function registerAndBackfillItems(
  pgPool: Pool,
  escapedWorkerSchema: string,
  cronItems: CronItem[],
  startTime: Date,
) {
  // First, scan the DB to get our starting point.
  const { rows } = await pgPool.query<KnownCrontab>(
    `SELECT * FROM ${escapedWorkerSchema}.known_crontabs`,
  );

  // Compile this into a useful list

  const {
    backfillItemsAndDates,
    unknownIdentifiers,
  } = getBackfillAndUnknownItems(cronItems, rows);

  if (unknownIdentifiers.length) {
    // They're known startTime
    await pgPool.query(
      `
      INSERT INTO ${escapedWorkerSchema}.known_crontabs (identifier)
      SELECT identifier
      FROM unnest($1::text[]) AS unnest (identifier)
      ON CONFLICT DO NOTHING
      `,
      [unknownIdentifiers],
    );
  }

  // Then, if any jobs are overdue, trigger them.
  const largestBackfill = cronItems.reduce(
    (largest, item) => Math.max(item.options.backfillPeriod, largest),
    0,
  );
  if (largestBackfill > 0) {
    // Unsafe because we mutate it during the loop (for performance)
    const unsafeTs = new Date(+startTime - largestBackfill);
    roundToMinute(unsafeTs, true);

    while (unsafeTs < startTime) {
      const timeAgo = +startTime - +unsafeTs;
      const ts = unsafeTs.toISOString();
      const digest = digestTimestamp(unsafeTs);

      // The identifiers in this array are guaranteed to be unique, since cron
      // items are guaranteed to have unique identifiers.
      const itemsToBackfill: Array<JobAndIdentifier> = [];

      // See if anything needs backfilling for this timestamp
      for (const { item, notBefore } of backfillItemsAndDates) {
        if (
          item.options.backfillPeriod >= timeAgo &&
          unsafeTs >= notBefore &&
          cronItemMatches(item, digest)
        ) {
          itemsToBackfill.push({
            identifier: item.identifier,
            job: makeJobForItem(item, ts, true),
          });
        }
      }

      if (itemsToBackfill.length) {
        await executeCronJobs(pgPool, escapedWorkerSchema, itemsToBackfill, ts);
      }

      unsafeTs.setUTCMinutes(unsafeTs.getUTCMinutes() + 1);
    }
  }
}

const ONE_MINUTE = 60 * 1000;

/**
 * Executes our scheduled jobs as required.
 *
 * @param options - the common options
 * @param cronItems - MUTABLE list of cron items to monitor. Do not assume this is static.
 */
export const runCron = (
  options: RunnerOptions,
  cronItems: CronItem[],
  { pgPool }: CronRequirements,
): Cron => {
  const { logger, escapedWorkerSchema } = processSharedOptions(options);
  // TODO: events
  const promise = defer();
  let stopped = false;
  let timeout: NodeJS.Timer | null = null;

  function stop(e?: Error) {
    if (!stopped) {
      stopped = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (e) {
        promise.reject(e);
      } else {
        promise.resolve();
      }
    }
  }

  (async () => {
    const start = new Date();
    let nextTimestamp = roundToMinute(new Date(+start), true);

    const scheduleNextLoop = () => {
      // + 1 millisecond to try and ensure this happens in the next minute
      // rather than at the end of the previous.
      timeout = setTimeout(loop, Math.max(+nextTimestamp - Date.now() + 1, 0));
    };

    async function loop() {
      try {
        if (stopped) {
          return;
        }

        // THIS MUST COME BEFORE nextTimestamp IS MUTATED
        const digest = digestTimestamp(nextTimestamp);
        const ts = nextTimestamp.toISOString();
        const expectedTimestamp = +nextTimestamp;

        // MUTATE nextTimestamp
        nextTimestamp.setUTCMinutes(nextTimestamp.getUTCMinutes() + 1);

        let currentTimestamp = Date.now();
        // Round to beginning of current minute
        currentTimestamp -= currentTimestamp % ONE_MINUTE;

        /*
         * In the event of clock skew, or overloaded runloop causing delays,
         * it's possible that expectedTimestamp and currentTimestamp might not
         * match up. If we've not hit expectedTimestamp yet, we should just
         * reschedule. If we've gone past expectedTimestamp then we should do as
         * much work as is necessary to catch up, ignoring backfill since this
         * is never expected to be a large period.
         */
        if (currentTimestamp < expectedTimestamp) {
          logger.warn("Graphile Worker Cron fired too early; rescheduling");
          scheduleNextLoop();
          return;
        } else if (currentTimestamp > expectedTimestamp) {
          logger.warn(
            `Graphile Worker Cron fired too late; catching up (${
              (currentTimestamp - expectedTimestamp) / ONE_MINUTE
            } minutes behind)`,
          );
        }

        // The identifiers in this array are guaranteed to be unique.
        const jobAndIdentifier: Array<JobAndIdentifier> = [];

        // Gather the relevant jobs
        for (const item of cronItems) {
          if (cronItemMatches(item, digest)) {
            jobAndIdentifier.push({
              identifier: item.identifier,
              job: makeJobForItem(item, ts),
            });
          }
        }

        // Finally actually run the jobs.
        if (jobAndIdentifier.length) {
          await executeCronJobs(
            pgPool,
            escapedWorkerSchema,
            jobAndIdentifier,
            ts,
          );
        }

        // If we stopped during the previous await, exit
        if (stopped) {
          return;
        }

        // This must come at the very end (otherwise we might accidentally skip
        // timestamps on error).
        scheduleNextLoop();
      } catch (e) {
        // If something goes wrong; abort. The calling code should re-schedule
        // which will re-trigger the backfilling code.
        return stop(e);
      }
    }

    await registerAndBackfillItems(
      pgPool,
      escapedWorkerSchema,
      cronItems,
      new Date(+start),
    );

    scheduleNextLoop();
  })().catch(stop);

  return {
    release() {
      if (!stopped) {
        stop();
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

interface TimestampDigest {
  min: number;
  hour: number;
  date: number;
  month: number;
  dow: number;
}

function digestTimestamp(ts: Date): TimestampDigest {
  const min = ts.getUTCMinutes();
  const hour = ts.getUTCHours();
  const date = ts.getUTCDate();
  const month = ts.getUTCMonth() + 1;
  const dow = ts.getUTCDay();
  return { min, hour, date, month, dow };
}

export function cronItemMatches(
  cronItem: CronItem,
  digest: TimestampDigest,
): boolean {
  const { min, hour, date, month, dow } = digest;

  if (
    cronItem.minutes.includes(min) &&
    cronItem.hours.includes(hour) &&
    cronItem.months.includes(month)
  ) {
    // Cron has a special behaviour: if both date and day of week are
    // exclusionary (i.e. not "*") then a match for *either* passes.
    const dateIsExclusionary = cronItem.dates.length !== 31;
    const dowIsExclusionary = cronItem.dows.length !== 7;
    if (dateIsExclusionary && dowIsExclusionary) {
      return cronItem.dates.includes(date) || cronItem.dows.includes(dow);
    } else if (dateIsExclusionary) {
      return cronItem.dates.includes(date);
    } else if (dowIsExclusionary) {
      return cronItem.dows.includes(date);
    } else {
      return true;
    }
  }
  return false;
}
