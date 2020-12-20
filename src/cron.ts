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

/**
 * Rounds the incoming date to the nearest minute (either rounding up or down).
 * Tagged "unsafe" because it mutates the argument, this is desired for
 * performance but may be unexpected.
 */
function unsafeRoundToMinute(ts: Date, roundUp = false): Date {
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

/**
 * Schedules a list of cron jobs all due at the same timestamp. Jobs that were
 * already scheduled (e.g. via a different Worker instance) will be skipped
 * automatically.
 */
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

/**
 * Marks any previously unknown crontab identifiers as now being known. Then
 * performs backfilling on any crontab tasks that need it.
 */
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

  const {
    backfillItemsAndDates,
    unknownIdentifiers,
  } = getBackfillAndUnknownItems(cronItems, rows);

  if (unknownIdentifiers.length) {
    // They're known now.
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

  // If any jobs are overdue, trigger them.
  // NOTE: this is not the fastest algorithm, we can definitely optimise this later.
  // First find out the largest backfill period:
  const largestBackfill = cronItems.reduce(
    (largest, item) => Math.max(item.options.backfillPeriod, largest),
    0,
  );
  // Then go back this period in time and fill forward from there.
  if (largestBackfill > 0) {
    // Unsafe because we mutate it during the loop (for performance); be sure
    // to take a copy of it (or convert to string) when used in places where
    // later mutation would cause issues.
    const unsafeTs = new Date(+startTime - largestBackfill);

    // Round up to the nearest minute.
    unsafeRoundToMinute(unsafeTs, true);

    // We're `await`-ing inside this loop: serialization is desired. If we were
    // to parallelize this (e.g. with `Promise.all`) then race conditions could
    // mean that backfilling of earlier tasks is skipped because
    // known_crontabs.last_execution may be advanced for a later backfill
    // before an earlier backfill occurs.
    while (unsafeTs < startTime) {
      const timeAgo = +startTime - +unsafeTs;
      // Note: `ts` and `digest` are both safe.
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
        // We're currently backfilling once per timestamp (rather than
        // gathering them all together and doing a single statement) due to
        // the way the last_execution column of the known_crontabs table works.
        // At this time it's not expected that backfilling will be sufficiently
        // expensive to justify optimising this further.
        await executeCronJobs(pgPool, escapedWorkerSchema, itemsToBackfill, ts);
      }

      // Advance our counter (or risk infinite loop!).
      unsafeTs.setUTCMinutes(unsafeTs.getUTCMinutes() + 1);
    }
  }
}

/** One minute in milliseconds */
const ONE_MINUTE = 60 * 1000;

/**
 * Executes our scheduled jobs as required.
 *
 * This is not currently intended for usage directly; use `run` instead.
 *
 * @internal
 *
 * @param options - the common options
 * @param cronItems - MUTABLE list of cron items to monitor. Do not assume this is static.
 * @param requirements - the helpers that this task needs
 */
export const runCron = (
  options: RunnerOptions,
  cronItems: CronItem[],
  requirements: CronRequirements,
): Cron => {
  const { pgPool } = requirements;
  const { logger, escapedWorkerSchema } = processSharedOptions(options);

  // TODO: add events

  const promise = defer();
  let released = false;
  let timeout: NodeJS.Timer | null = null;

  let stopCalled = false;
  function stop(e?: Error) {
    if (!stopCalled) {
      stopCalled = true;
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (e) {
        promise.reject(e);
      } else {
        promise.resolve();
      }
    } else {
      logger.error(
        "Graphile Worker internal bug in src/cron.ts: calling `stop()` more than once shouldn't be possible. Please report this.",
      );
    }
  }

  async function cronMain() {
    if (released) {
      return stop();
    }

    const start = new Date();

    // We must backfill BEFORE scheduling any new jobs otherwise backfill won't
    // work due to known_crontabs.last_execution having been updated.
    await registerAndBackfillItems(
      pgPool,
      escapedWorkerSchema,
      cronItems,
      new Date(+start),
    );

    if (released) {
      return stop();
    }

    // The backfill may have taken a moment, we should continue from where the
    // worker started and catch up as quickly as we can. This does **NOT**
    // count as a backfill.
    let nextTimestamp = unsafeRoundToMinute(new Date(+start), true);

    const scheduleNextLoop = () => {
      if (released) {
        return stop();
      }
      // + 1 millisecond to try and ensure this happens in the next minute
      // rather than at the end of the previous.
      timeout = setTimeout(() => {
        timeout = null;
        loop();
      }, Math.max(+nextTimestamp - Date.now() + 1, 0));
    };

    async function loop() {
      try {
        if (released) {
          return stop();
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

          if (released) {
            return stop();
          }
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

    scheduleNextLoop();
  }

  cronMain().catch(stop);

  return {
    release() {
      if (!released) {
        released = true;
        if (timeout) {
          // Next loop is queued; lets cancel it early
          stop();
        }
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
      "`crontab` and `crontabItems` must not be set at the same time.",
    );

    return parseCrontab(crontab);
  } else if (crontabFile) {
    assert(
      !cronItems,
      "`crontabFile` and `crontabItems` must not be set at the same time.",
    );

    const watchedCronItems = await getCronItems(options, crontabFile, false);
    releasers.push(() => watchedCronItems.release());
    return watchedCronItems.items;
  } else {
    assert(cronItems != null, "Expected `cronItems` to be set.");

    return cronItems;
  }
}

/**
 * The digest of a timestamp into the component parts that a cron schedule cares about.
 */
interface TimestampDigest {
  min: number;
  hour: number;
  date: number;
  month: number;
  dow: number;
}

/**
 * Digests a timestamp into its min/hour/date/month/dow components that are
 * needed for cron matching.
 *
 * WARNING: the timestamp passed into this function might be mutated later, so
 * **do not memoize** using the value itself. If memoization is necessary, it
 * could be done using `+ts` as the key.
 */
function digestTimestamp(ts: Date): TimestampDigest {
  const min = ts.getUTCMinutes();
  const hour = ts.getUTCHours();
  const date = ts.getUTCDate();
  const month = ts.getUTCMonth() + 1;
  const dow = ts.getUTCDay();
  return { min, hour, date, month, dow };
}

/**
 * Returns true if the cronItem should fire for the given timestamp digest,
 * false otherwise.
 */
export function cronItemMatches(
  cronItem: CronItem,
  digest: TimestampDigest,
): boolean {
  const { min, hour, date, month, dow } = digest;

  if (
    // If minute, hour and month match
    cronItem.minutes.includes(min) &&
    cronItem.hours.includes(hour) &&
    cronItem.months.includes(month)
  ) {
    const dateIsExclusionary = cronItem.dates.length !== 31;
    const dowIsExclusionary = cronItem.dows.length !== 7;
    if (dateIsExclusionary && dowIsExclusionary) {
      // Cron has a special behaviour: if both date and day of week are
      // exclusionary (i.e. not "*") then a match for *either* passes.
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
