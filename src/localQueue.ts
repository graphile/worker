import assert from "assert";

import {
  CompiledSharedOptions,
  EnhancedWithPgClient,
  PromiseOrDirect,
  WorkerPoolOptions,
} from ".";
import { MINUTE, SECOND } from "./cronConstants";
import defer, { Deferred } from "./deferred";
import { GetJobFunction, Job, TaskList, WorkerPool } from "./interfaces";
import { getJob as baseGetJob } from "./sql/getJob";
import { returnJob } from "./sql/returnJob";

const POLLING = "POLLING";
const WAITING = "WAITING";
const TTL_EXPIRED = "TTL_EXPIRED";
const RELEASED = "RELEASED";

/**
 * The local queue exists to reduce strain on the database; it works by
 * fetching a batch of jobs from the database and distributing them to workers
 * as and when necessary. It is also responsible for polling when in use,
 * relieving the workers of this responsibility.
 *
 * The local queue trades latency for throughput: jobs may sit in the local
 * queue for a longer time (maximum `localQueueSize` jobs waiting maximum
 * `localQueueTTL` milliseconds), but fewer requests to the database are made
 * for jobs since more jobs are fetched at once, enabling the worker to reach
 * higher levels of performance (and reducing read stress on the DB).
 *
 * The local queue is always in one of these modes:
 *
 * - POLLING mode
 * - WAITING mode
 * - TTL_EXPIRED mode
 * - RELEASED mode
 *
 * ## POLLING mode
 *
 * POLLING mode is the initial state of the local queue. The queue will only be
 * in POLLING mode when it contains no cached jobs.
 *
 * When the queue enters POLLING mode (and when it starts) it will trigger a
 * fetch of jobs from the database.
 *
 * If no jobs were returned then it will wait `pollInterval` ms and then fetch
 * again.
 *
 * If a "new job" notification is received during the polling interval then the
 * timer will be cancelled, and a fetch will be fired immediately.
 *
 * If jobs are returned from a POLLING mode fetch then the queue immediately
 * enters WAITING mode.
 *
 * ## WAITING mode
 *
 * The local queue can only be in WAITING mode if there are cached jobs.
 *
 * Any waiting clients are issued any available cached jobs.
 *
 * If no cached jobs remain, then the local queue enters POLLING mode,
 * triggering a fetch.
 *
 * If cached jobs remain (even if there's just one, even if it has been 30
 * minutes since the last fetch) then the local queue continues to wait for
 * a worker to claim the remaining jobs. Once no jobs remain, the local queue
 * reverts to POLLING mode, triggering a fetch.
 *
 * In WAITING mode, all "new job" announcements are ignored.
 *
 * The local queue can be in WAITING mode for at most `getJobBatchTime`
 * milliseconds (default: 30 minutes), after which all unclaimed jobs are
 * returned to the pool and the local queue enters TTL_EXPIRED mode.
 *
 * ## TTL_EXPIRED mode
 *
 * This mode is used when jobs were queued in WAITING mode for too long. The
 * local queue will sit in TTL_EXPIRED mode until a worker asks for a job,
 * whereupon the local queue will enter POLLING mode (triggering a fetch).
 *
 * ## RELEASED mode
 *
 * Triggered on shutdown.
 */

export class LocalQueue {
  readonly ttl: number;
  readonly pollInterval: number;
  readonly jobQueue: Job[] = [];
  readonly workerQueue: Deferred<Job>[] = [];
  fetchInProgress = false;
  ttlExpiredTimer: NodeJS.Timeout | null = null;
  fetchTimer: NodeJS.Timeout | null = null;
  // Set true to fetch immediately after a fetch completes; typically only used
  // when the queue is pulsed during a fetch.
  fetchAgain = false;
  mode: typeof POLLING | typeof WAITING | typeof TTL_EXPIRED | typeof RELEASED;
  private promise = defer();
  private backgroundCount = 0;

  constructor(
    private readonly compiledSharedOptions: CompiledSharedOptions<WorkerPoolOptions>,
    private readonly tasks: TaskList,
    private readonly withPgClient: EnhancedWithPgClient,
    private readonly workerPool: WorkerPool,
    private readonly getJobBatchSize: number,
    private readonly continuous: boolean,
  ) {
    this.ttl =
      compiledSharedOptions.resolvedPreset.worker.localQueueTtl ?? 5 * MINUTE;
    this.pollInterval =
      compiledSharedOptions.resolvedPreset.worker.pollInterval ?? 2 * SECOND;
    this.setModePolling();
  }

  private decreaseBackgroundCount = () => {
    this.backgroundCount--;
    if (this.mode === "RELEASED" && this.backgroundCount === 0) {
      this.promise.resolve();
    }
  };

  /**
   * For promises that happen in the background, but that we want to ensure are
   * handled before we release the queue (so that the database pool isn't
   * released too early).
   */
  private background(promise: Promise<void>) {
    if (this.mode === "RELEASED" && this.backgroundCount === 0) {
      throw new Error(
        `Cannot background something when the queue is already released`,
      );
    }
    this.backgroundCount++;
    promise.then(this.decreaseBackgroundCount, this.decreaseBackgroundCount);
  }

  private setModePolling() {
    assert.ok(
      !this.fetchTimer,
      "Cannot enter polling mode when a fetch is scheduled",
    );
    assert.ok(
      !this.fetchInProgress,
      "Cannot enter polling mode when fetch is in progress",
    );
    assert.equal(
      this.jobQueue.length,
      0,
      "Cannot enter polling mode when job queue isn't empty",
    );

    if (this.ttlExpiredTimer) {
      clearTimeout(this.ttlExpiredTimer);
      this.ttlExpiredTimer = null;
    }

    this.mode = POLLING;

    this.fetch();
  }

  private setModeWaiting() {
    // Can only enter WAITING mode from POLLING mode.
    assert.equal(this.mode, POLLING);
    assert.ok(
      !this.fetchTimer,
      "Cannot enter waiting mode when a fetch is scheduled",
    );
    assert.ok(
      !this.fetchInProgress,
      "Cannot enter waiting mode when fetch is in progress",
    );
    assert.notEqual(
      this.jobQueue.length,
      0,
      "Cannot enter waiting mode when job queue is empty",
    );

    if (this.ttlExpiredTimer) {
      clearTimeout(this.ttlExpiredTimer);
    }

    this.mode = WAITING;

    this.ttlExpiredTimer = setTimeout(() => {
      this.setModeTtlExpired();
    }, this.ttl);
  }

  private setModeTtlExpired() {
    // Can only enter TTL_EXPIRED mode from WAITING mode.
    assert.equal(this.mode, WAITING);
    assert.ok(
      !this.fetchTimer,
      "Cannot enter TTL expired mode when a fetch is scheduled",
    );
    assert.ok(
      !this.fetchInProgress,
      "Cannot enter TTL expired mode when fetch is in progress",
    );
    assert.notEqual(
      this.jobQueue.length,
      0,
      "Cannot enter TTL expired mode when job queue is empty",
    );

    if (this.ttlExpiredTimer) {
      clearTimeout(this.ttlExpiredTimer);
      this.ttlExpiredTimer = null;
    }

    this.mode = TTL_EXPIRED;

    // Return jobs to the pool
    this.returnJobs();
  }

  private returnJobs() {
    const jobsToReturn = this.jobQueue.splice(0, this.jobQueue.length);
    this.background(
      returnJob(
        this.compiledSharedOptions,
        this.withPgClient,
        this.workerPool.id,
        jobsToReturn,
      ).then((e) => {
        // TODO: handle this better!
        this.compiledSharedOptions.logger.error(
          `Failed to return jobs from local queue to database queue`,
          { error: e },
        );
      }),
    );
  }

  private fetch = (): void => {
    this.background(
      this._fetch().catch((e) => {
        // This should not happen
        this.compiledSharedOptions.logger.error(`Error occurred during fetch`, {
          error: e,
        });
      }),
    );
  };

  private async _fetch() {
    let fetchedMax = false;
    try {
      assert.equal(this.mode, POLLING, "Can only fetch when in polling mode");
      assert.equal(
        this.fetchInProgress,
        false,
        "Cannot fetch when a fetch is already in progress",
      );
      if (this.fetchTimer) {
        clearTimeout(this.fetchTimer);
        this.fetchTimer = null;
      }
      this.fetchAgain = false;
      this.fetchInProgress = true;

      // The ONLY await in this function.
      const jobs = await baseGetJob(
        this.compiledSharedOptions,
        this.withPgClient,
        this.tasks,
        this.workerPool.id,
        null,
        this.getJobBatchSize,
      );

      assert.equal(
        this.jobQueue.length,
        0,
        "Should not fetch when job queue isn't empty",
      );
      const jobCount = jobs.length;
      fetchedMax = jobCount >= this.getJobBatchSize;
      const workerCount = Math.min(jobCount, this.workerQueue.length);
      const workers = this.workerQueue.splice(0, workerCount);
      for (let i = 0; i < jobCount; i++) {
        const job = jobs[i];
        if (i < workerCount) {
          workers[i].resolve(job);
        } else {
          this.jobQueue.push(job);
        }
      }
    } catch (e) {
      // Error happened; rely on poll interval.
      this.compiledSharedOptions.logger.error(
        `Error occurred fetching jobs; will try again on next poll interval. Error: ${e}`,
        { error: e },
      );
    } finally {
      this.fetchInProgress = false;
    }

    // Finally, now that there is no fetch in progress, choose what to do next
    if (this.mode === "RELEASED") {
      this.returnJobs();
    } else if (this.jobQueue.length > 0) {
      this.setModeWaiting();
    } else {
      if (fetchedMax || this.fetchAgain) {
        // Maximal fetch; trigger immediate refetch
        this.fetch();
      } else if (this.continuous) {
        // Set up the timer
        this.fetchTimer = setTimeout(this.fetch, this.pollInterval);
      } else {
        this.setModeReleased();
      }
    }
  }

  /** Called when a new job becomes available in the DB */
  public pulse() {
    // The only situation when this affects anything is if we're running in polling mode.
    if (this.mode === POLLING) {
      if (this.fetchInProgress) {
        this.fetchAgain = true;
      } else if (this.fetchTimer) {
        clearTimeout(this.fetchTimer);
        this.fetchTimer = null;
        this.fetch();
      }
    }
  }

  // If you refactor this to be a method rather than a property, make sure that you `.bind(this)` to it.
  public getJob: GetJobFunction = (workerId, flagsToSkip) => {
    if (this.mode === RELEASED) {
      return undefined;
    }

    // Cannot batch if there's flags
    if (flagsToSkip !== null) {
      const jobsPromise = baseGetJob(
        this.compiledSharedOptions,
        this.withPgClient,
        this.tasks,
        this.workerPool.id,
        flagsToSkip,
        1,
      );
      return jobsPromise.then((jobs) => jobs[0]);
    }

    if (this.mode === TTL_EXPIRED) {
      this.setModePolling();
    }

    const job = this.jobQueue.shift();
    if (job !== undefined) {
      if (this.jobQueue.length === 0) {
        assert.equal(this.mode, WAITING);
        this.setModePolling();
      }
      return job;
    } else {
      const d = defer<Job>();
      this.workerQueue.push(d);
      return d;
    }
  };

  public release() {
    if (this.mode !== "RELEASED") {
      this.setModeReleased();
    }
    return this.promise;
  }

  private setModeReleased() {
    assert.notEqual(
      this.mode,
      RELEASED,
      "LocalQueue must only be released once",
    );

    const oldMode = this.mode;
    this.mode = RELEASED;

    if (oldMode === POLLING) {
      // Release pending workers
      const workers = this.workerQueue.splice(0, this.workerQueue.length);
      workers.forEach((w) => w.resolve(undefined));

      // Release next fetch call
      if (this.fetchTimer) {
        clearTimeout(this.fetchTimer);
        this.fetchTimer = null;
        this.promise.resolve();
      } else {
        // Rely on checking mode at end of fetch
      }
    } else if (oldMode === WAITING) {
      if (this.ttlExpiredTimer) {
        clearTimeout(this.ttlExpiredTimer);
        this.ttlExpiredTimer = null;
      }
      // Trigger the jobs to be released
      this.returnJobs();
    } else if (oldMode === TTL_EXPIRED) {
      // No action necessary
    }

    if (this.backgroundCount === 0) {
      this.promise.resolve();
    }
  }
}
