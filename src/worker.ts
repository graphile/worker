import {
  TaskList,
  Worker,
  Job,
  WithPgClient,
  WorkerOptions,
} from "./interfaces";
import { POLL_INTERVAL, MAX_CONTIGUOUS_ERRORS } from "./config";
import * as assert from "assert";
import deferred from "./deferred";
import { makeHelpers } from "./helpers";
import { defaultLogger } from "./logger";

export function makeNewWorker(
  tasks: TaskList,
  withPgClient: WithPgClient,
  options: WorkerOptions = {},
  continuous = true
): Worker {
  const {
    pollInterval = POLL_INTERVAL,
    // The `||0.1` is to eliminate the vanishingly-small possibility of Math.random() returning 0. Math.random() can never return 1.
    workerId = `worker-${String(Math.random() || 0.1).substr(2)}`,
    logger: baseLogger = defaultLogger,
  } = options;
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

  const logger = baseLogger.scope({
    label: "worker",
    workerId,
  });

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

      const {
        rows: [jobRow],
      } = await withPgClient(client =>
        client.query({
          text:
            // TODO: breaking change; change this to more optimal:
            // "SELECT id, queue_name, task_identifier, payload FROM graphile_worker.get_job($1, $2);",
            "SELECT * FROM graphile_worker.get_job($1, $2);",
          values: [workerId, supportedTaskNames],
          name: "get_job",
        })
      );

      // `doNext` cannot be executed concurrently, so we know this is safe.
      // eslint-disable-next-line require-atomic-updates
      activeJob = jobRow && jobRow.id ? jobRow : null;
    } catch (err) {
      if (continuous) {
        contiguousErrors++;
        logger.debug(
          `Failed to acquire job: ${err.message} (${contiguousErrors}/${MAX_CONTIGUOUS_ERRORS})`
        );
        if (contiguousErrors >= MAX_CONTIGUOUS_ERRORS) {
          promise.reject(
            new Error(
              `Failed ${contiguousErrors} times in a row to acquire job; latest error: ${err.message}`
            )
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
        const helpers = makeHelpers(job, { withPgClient }, logger);
        await task(job.payload, helpers);
      } catch (error) {
        err = error;
      }
      const durationRaw = process.hrtime(startTimestamp);
      const duration = durationRaw[0] * 1e3 + durationRaw[1] * 1e-6;
      if (err) {
        const { message, stack } = err;
        logger.error(
          `Failed task ${job.id} (${job.task_identifier}) with error ${
            err.message
          } (${duration.toFixed(2)}ms)${
            stack
              ? `:\n  ${String(stack)
                  .replace(/\n/g, "\n  ")
                  .trim()}`
              : ""
          }`,
          { failure: true, job, error: err, duration }
        );
        // TODO: retry logic, in case of server connection interruption
        await withPgClient(client =>
          client.query({
            text: "SELECT FROM graphile_worker.fail_job($1, $2, $3);",
            values: [workerId, job.id, message],
            name: "fail_job",
          })
        );
      } else {
        if (!process.env.NO_LOG_SUCCESS) {
          logger.info(
            `Completed task ${job.id} (${
              job.task_identifier
            }) with success (${duration.toFixed(2)}ms)`,
            { job, duration, success: true }
          );
        }
        // TODO: retry logic, in case of server connection interruption
        await withPgClient(client =>
          client.query({
            text: "SELECT FROM graphile_worker.complete_job($1, $2);",
            values: [workerId, job.id],
            name: "complete_job",
          })
        );
      }
    } catch (fatalError) {
      const when = err ? `after failure '${err.message}'` : "after success";
      logger.error(
        `Failed to release job '${job.id}' ${when}; committing seppuku\n${fatalError.message}`,
        { fatalError, job }
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
