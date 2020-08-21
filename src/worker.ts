import * as assert from "assert";
import { randomBytes } from "crypto";

import { defaults } from "./config";
import deferred from "./deferred";
import { makeJobHelpers } from "./helpers";
import {
  Job,
  TaskList,
  WithPgClient,
  Worker,
  WorkerOptions,
} from "./interfaces";
import { processSharedOptions } from "./lib";

export function makeNewWorker(
  options: WorkerOptions,
  tasks: TaskList,
  withPgClient: WithPgClient,
  continuous = true,
): Worker {
  const {
    workerId = `worker-${randomBytes(9).toString("hex")}`,
    pollInterval = defaults.pollInterval,
    noPreparedStatements,
    forbiddenFlags,
  } = options;
  const {
    workerSchema,
    escapedWorkerSchema,
    logger,
    maxContiguousErrors,
  } = processSharedOptions(options, {
    scope: {
      label: "worker",
      workerId,
    },
  });
  const promise = deferred();
  let activeJob: Job | null = null;

  let doNextTimer: NodeJS.Timer | null = null;
  const cancelDoNext = () => {
    if (doNextTimer !== null) {
      clearTimeout(doNextTimer);
      doNextTimer = null;
      return true;
    }
    return false;
  };
  let active = true;

  const release = () => {
    if (!active) {
      return;
    }
    active = false;
    if (cancelDoNext()) {
      // Nothing in progress; resolve the promise
      promise.resolve();
    }
    return promise;
  };

  logger.debug(`Spawned`);

  let contiguousErrors = 0;
  let again = false;

  const doNext = async (): Promise<void> => {
    again = false;
    cancelDoNext();
    assert(active, "doNext called when active was false");
    assert(!activeJob, "There should be no active job");

    // Find us a job
    try {
      const supportedTaskNames = Object.keys(tasks);
      assert(supportedTaskNames.length, "No runnable tasks!");

      let flagsToSkip: null | string[] = null;

      if (Array.isArray(forbiddenFlags)) {
        flagsToSkip = forbiddenFlags;
      } else if (typeof forbiddenFlags === "function") {
        const forbiddenFlagsResult = forbiddenFlags();

        if (Array.isArray(forbiddenFlagsResult)) {
          flagsToSkip = forbiddenFlagsResult;
        } else if (forbiddenFlagsResult != null) {
          flagsToSkip = await forbiddenFlagsResult;
        }
      }

      const {
        rows: [jobRow],
      } = await withPgClient((client) =>
        client.query({
          text:
            // TODO: breaking change; change this to more optimal:
            // `SELECT id, queue_name, task_identifier, payload FROM ...`,
            `SELECT * FROM ${escapedWorkerSchema}.get_job($1, $2, forbidden_flags := $3::text[]);`,
          values: [
            workerId,
            supportedTaskNames,
            flagsToSkip && flagsToSkip.length ? flagsToSkip : null,
          ],
          name: noPreparedStatements ? undefined : `get_job/${workerSchema}`,
        }),
      );

      // `doNext` cannot be executed concurrently, so we know this is safe.
      // eslint-disable-next-line require-atomic-updates
      activeJob = jobRow && jobRow.id ? jobRow : null;
    } catch (err) {
      if (continuous) {
        contiguousErrors++;
        logger.debug(
          `Failed to acquire job: ${err.message} (${contiguousErrors}/${maxContiguousErrors})`,
        );
        if (contiguousErrors >= maxContiguousErrors) {
          promise.reject(
            new Error(
              `Failed ${contiguousErrors} times in a row to acquire job; latest error: ${err.message}`,
            ),
          );
          release();
          return;
        } else {
          if (active) {
            // Error occurred fetching a job; try again...
            doNextTimer = setTimeout(() => doNext(), pollInterval);
          } else {
            promise.reject(err);
          }
          return;
        }
      } else {
        promise.reject(err);
        release();
        return;
      }
    }
    contiguousErrors = 0;

    // If we didn't get a job, try again later (if appropriate)
    if (!activeJob) {
      if (continuous) {
        if (active) {
          if (again) {
            // This could be a synchronisation issue where we were notified of
            // the job but it's not visible yet, lets try again in just a
            // moment.
            doNext();
          } else {
            doNextTimer = setTimeout(() => doNext(), pollInterval);
          }
        } else {
          promise.resolve();
        }
      } else {
        promise.resolve();
        release();
      }
      return;
    }

    // We did get a job then; store it into the current scope.
    const job = activeJob;

    // We may want to know if an error occurred or not
    let err: Error | null = null;
    try {
      /*
       * Be **VERY** careful about which parts of this code can throw - we
       * **MUST** release the job once we've attempted it (success or error).
       */
      const startTimestamp = process.hrtime();
      try {
        logger.debug(`Found task ${job.id} (${job.task_identifier})`);
        const task = tasks[job.task_identifier];
        assert(task, `Unsupported task '${job.task_identifier}'`);
        const helpers = makeJobHelpers(options, job, { withPgClient, logger });
        await task(job.payload, helpers);
      } catch (error) {
        err = error;
      }
      const durationRaw = process.hrtime(startTimestamp);
      const duration = durationRaw[0] * 1e3 + durationRaw[1] * 1e-6;
      if (err) {
        const { message: rawMessage, stack } = err;

        /**
         * Guaranteed to be a non-empty string
         */
        const message: string =
          rawMessage ||
          String(err) ||
          "Non error or error without message thrown.";

        logger.error(
          `Failed task ${job.id} (${
            job.task_identifier
          }) with error ${message} (${duration.toFixed(2)}ms)${
            stack ? `:\n  ${String(stack).replace(/\n/g, "\n  ").trim()}` : ""
          }`,
          { failure: true, job, error: err, duration },
        );
        // TODO: retry logic, in case of server connection interruption
        await withPgClient((client) =>
          client.query({
            text: `SELECT FROM ${escapedWorkerSchema}.fail_job($1, $2, $3);`,
            values: [workerId, job.id, message],
            name: noPreparedStatements ? undefined : `fail_job/${workerSchema}`,
          }),
        );
      } else {
        if (!process.env.NO_LOG_SUCCESS) {
          logger.info(
            `Completed task ${job.id} (${
              job.task_identifier
            }) with success (${duration.toFixed(2)}ms)`,
            { job, duration, success: true },
          );
        }
        // TODO: retry logic, in case of server connection interruption
        await withPgClient((client) =>
          client.query({
            text: `SELECT FROM ${escapedWorkerSchema}.complete_job($1, $2);`,
            values: [workerId, job.id],
            name: noPreparedStatements
              ? undefined
              : `complete_job/${workerSchema}`,
          }),
        );
      }
    } catch (fatalError) {
      const when = err ? `after failure '${err.message}'` : "after success";
      logger.error(
        `Failed to release job '${job.id}' ${when}; committing seppuku\n${fatalError.message}`,
        { fatalError, job },
      );
      promise.reject(fatalError);
      release();
      return;
    } finally {
      // `doNext` cannot be executed concurrently, so we know this is safe.
      // eslint-disable-next-line require-atomic-updates
      activeJob = null;
    }
    if (active) {
      doNext();
    } else {
      promise.resolve();
    }
  };

  const nudge = () => {
    assert(active, "nudge called after worker terminated");
    if (doNextTimer) {
      // Must be idle; call early
      doNext();
      return true;
    } else {
      again = true;
      // Not idle; find someone else!
      return false;
    }
  };

  // Start!
  doNext();

  const worker = {
    nudge,
    workerId,
    release,
    promise,
    getActiveJob: () => activeJob,
  };

  // For tests
  promise["worker"] = worker;

  return worker;
}
