import * as assert from "assert";
import { Pool } from "pg";

import { parseCrontab } from "./crontab";
import defer from "./deferred";
import getCronItems from "./getCronItems";
import {
  $$isParsed,
  Cron,
  CronJob,
  JobAndCronIdentifier,
  KnownCrontab,
  ParsedCronItem,
  RunnerOptions,
  TimestampDigest,
  WorkerEvents,
} from "./interfaces";
import { processSharedOptions, Releasers } from "./lib";

interface CronRequirements {
  pgPool: Pool;
  events: WorkerEvents;
}

/**
 * This function looks through all the cron items we have (e.g. from our
 * crontab file) and compares them to the items we already know about. If the
 * item is not previously know, we add it to the list `unknownIdentifiers` so
 * that it can be recorded in the database (i.e. it will be "known" from now
 * on). If the item was previously known, we add an entry to
 * `backfillItemsAndDates` indicating the `item` and earliest time
 * (`notBefore`) that a backfill should operate from. This is later compared
 * to the configuration to see how much backfilling to do.
 */
function getBackfillAndUnknownItems(
  parsedCronItems: ParsedCronItem[],
  knownCrontabs: KnownCrontab[],
) {
  const backfillItemsAndDates: Array<{
    item: ParsedCronItem;
    notBefore: Date;
  }> = [];
  const unknownIdentifiers: string[] = [];
  for (const item of parsedCronItems) {
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

function makeJobForItem(
  item: ParsedCronItem,
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

/**
 * Schedules a list of cron jobs all due at the same timestamp. Jobs that were
 * already scheduled (e.g. via a different Worker instance) will be skipped
 * automatically.
 */
async function scheduleCronJobs(
  pgPool: Pool,
  escapedWorkerSchema: string,
  jobsAndIdentifiers: JobAndCronIdentifier[],
  ts: string,
  useNodeTime: boolean,
) {
  // TODO: refactor this to use `add_jobs`

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
        insert into ${escapedWorkerSchema}.known_crontabs (identifier, known_since, last_execution)
        select
          specs.identifier,
          $2::timestamptz as known_since,
          $2::timestamptz as last_execution
        from specs
        on conflict (identifier)
        do update set last_execution = excluded.last_execution
        where (known_crontabs.last_execution is null or known_crontabs.last_execution < excluded.last_execution)
        returning known_crontabs.identifier
      )
      select
        ${escapedWorkerSchema}.add_job(
          specs.task,
          specs.payload,
          specs.queue_name,
          coalesce(specs.run_at, $3::timestamptz, now()),
          specs.max_attempts,
          null, -- job key
          specs.priority
        )
      from specs
      inner join locks on (locks.identifier = specs.identifier)
      order by specs.index asc
    `,
    [
      JSON.stringify(jobsAndIdentifiers),
      ts,
      useNodeTime ? new Date().toISOString() : null,
    ],
  );
}

/**
 * Marks any previously unknown crontab identifiers as now being known. Then
 * performs backfilling on any crontab tasks that need it.
 */
async function registerAndBackfillItems(
  { pgPool, events, cron }: { pgPool: Pool; events: WorkerEvents; cron: Cron },
  escapedWorkerSchema: string,
  parsedCronItems: ParsedCronItem[],
  startTime: Date,
  useNodeTime: boolean,
) {
  // First, scan the DB to get our starting point.
  const { rows } = await pgPool.query<KnownCrontab>(
    `SELECT * FROM ${escapedWorkerSchema}.known_crontabs`,
  );

  const { backfillItemsAndDates, unknownIdentifiers } =
    getBackfillAndUnknownItems(parsedCronItems, rows);

  if (unknownIdentifiers.length) {
    // They're known now.
    await pgPool.query(
      `
      INSERT INTO ${escapedWorkerSchema}.known_crontabs (identifier, known_since)
      SELECT identifier, $2::timestamptz
      FROM unnest($1::text[]) AS unnest (identifier)
      ON CONFLICT DO NOTHING
      `,
      [unknownIdentifiers, startTime.toISOString()],
    );
  }

  // If any jobs are overdue, trigger them.
  // NOTE: this is not the fastest algorithm, we can definitely optimise this later.
  // First find out the largest backfill period:
  const largestBackfill = parsedCronItems.reduce(
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
      const itemsToBackfill: Array<JobAndCronIdentifier> = [];

      // See if anything needs backfilling for this timestamp
      for (const { item, notBefore } of backfillItemsAndDates) {
        if (
          item.options.backfillPeriod >= timeAgo &&
          unsafeTs >= notBefore &&
          item.match(digest)
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
        events.emit("cron:backfill", {
          cron,
          itemsToBackfill,
          timestamp: ts,
        });
        await scheduleCronJobs(
          pgPool,
          escapedWorkerSchema,
          itemsToBackfill,
          ts,
          useNodeTime,
        );
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
 * @param parsedCronItems - MUTABLE list of _parsed_ cron items to monitor. Do not assume this is static.
 * @param requirements - the helpers that this task needs
 */
export const runCron = (
  options: RunnerOptions,
  parsedCronItems: ParsedCronItem[],
  requirements: CronRequirements,
): Cron => {
  const { pgPool } = requirements;
  const { logger, escapedWorkerSchema, events, useNodeTime } =
    processSharedOptions(options);

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
    events.emit("cron:starting", { cron: this, start });

    // We must backfill BEFORE scheduling any new jobs otherwise backfill won't
    // work due to known_crontabs.last_execution having been updated.
    await registerAndBackfillItems(
      { pgPool, events, cron: this },
      escapedWorkerSchema,
      parsedCronItems,
      new Date(+start),
      useNodeTime,
    );

    events.emit("cron:started", { cron: this, start });

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
      }, Math.max(+nextTimestamp - Date.now() + 1, 1));
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

        // With seconds and milliseconds
        const currentTimestamp = Date.now();
        // Round to beginning of current minute; should match expectedTimestamp
        const roundedCurrentTimestamp =
          currentTimestamp - (currentTimestamp % ONE_MINUTE);

        /*
         * In the event of clock skew, or overloaded runloop causing delays,
         * it's possible that expectedTimestamp and roundedCurrentTimestamp
         * might not match up. If we've not hit expectedTimestamp yet, we
         * should just reschedule. If we've gone past expectedTimestamp then we
         * should do as much work as is necessary to catch up, ignoring
         * backfill since this is never expected to be a large period.
         */
        if (roundedCurrentTimestamp < expectedTimestamp) {
          logger.debug(
            `Graphile Worker Cron fired ${(
              (expectedTimestamp - currentTimestamp) /
              1000
            ).toFixed(3)}s too early (clock skew?); rescheduling`,
            {
              expectedTimestamp,
              currentTimestamp,
            },
          );
          events.emit("cron:prematureTimer", {
            cron: this,
            currentTimestamp,
            expectedTimestamp,
          });
          // NOTE: we must NOT have mutated nextTimestamp before here in `loop()`.
          scheduleNextLoop();
          return;
        } else if (roundedCurrentTimestamp > expectedTimestamp) {
          logger.debug(
            `Graphile Worker Cron fired too late; catching up (${Math.floor(
              (currentTimestamp - expectedTimestamp) / ONE_MINUTE,
            )}m${Math.floor(
              ((currentTimestamp - expectedTimestamp) % ONE_MINUTE) / 1000,
            )}s behind)`,
          );
          events.emit("cron:overdueTimer", {
            cron: this,
            currentTimestamp,
            expectedTimestamp,
          });
        }

        // The identifiers in this array are guaranteed to be unique.
        const jobsAndIdentifiers: Array<JobAndCronIdentifier> = [];

        // Gather the relevant jobs
        for (const item of parsedCronItems) {
          if (item.match(digest)) {
            jobsAndIdentifiers.push({
              identifier: item.identifier,
              job: makeJobForItem(item, ts),
            });
          }
        }

        // Finally actually run the jobs.
        if (jobsAndIdentifiers.length) {
          events.emit("cron:schedule", {
            cron: this,
            timestamp: expectedTimestamp,
            jobsAndIdentifiers,
          });
          await scheduleCronJobs(
            pgPool,
            escapedWorkerSchema,
            jobsAndIdentifiers,
            ts,
            useNodeTime,
          );
          events.emit("cron:scheduled", {
            cron: this,
            timestamp: expectedTimestamp,
            jobsAndIdentifiers,
          });

          if (released) {
            return stop();
          }
        }

        // MUTATE nextTimestamp: advance by a minute ready for the next run.
        nextTimestamp.setUTCMinutes(nextTimestamp.getUTCMinutes() + 1);

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

export async function getParsedCronItemsFromOptions(
  options: RunnerOptions,
  releasers: Releasers,
): Promise<Array<ParsedCronItem>> {
  const { crontabFile, parsedCronItems, crontab } = options;

  if (!crontabFile && !parsedCronItems && !crontab) {
    return [];
  }

  if (crontab) {
    assert(
      !crontabFile,
      "`crontab` and `crontabFile` must not be set at the same time.",
    );
    assert(
      !parsedCronItems,
      "`crontab` and `parsedCronItems` must not be set at the same time.",
    );

    return parseCrontab(crontab);
  } else if (crontabFile) {
    assert(
      !parsedCronItems,
      "`crontabFile` and `parsedCronItems` must not be set at the same time.",
    );

    const watchedCronItems = await getCronItems(options, crontabFile, false);
    releasers.push(() => watchedCronItems.release());
    return watchedCronItems.items;
  } else {
    assert(parsedCronItems != null, "Expected `parsedCronItems` to be set.");
    // Basic check to ensure that users remembered to call
    // `parseCronItems`/`parseCrontab`; not intended to be a full check, just a
    // quick one to catch the obvious errors. Keep in mind that
    // `parsedCronItems` is mutable so it may be changed later to contain more
    // entries; we can't keep performing these checks everywhere for
    // performance reasons.
    assert(
      Array.isArray(parsedCronItems),
      "Expected `parsedCronItems` to be an array; you must use a helper e.g. `parseCrontab()` or `parseCronItems()` to produce this value.",
    );
    const firstItem = parsedCronItems[0];
    if (firstItem) {
      if (!firstItem[$$isParsed]) {
        throw new Error(
          "Invalid `parsedCronItems`; you must use a helper e.g. `parseCrontab()` or `parseCronItems()` to produce this value.",
        );
      }
    }

    return parsedCronItems;
  }
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
