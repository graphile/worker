import assert from "assert";

import {
  CompiledSharedOptions,
  EnhancedWithPgClient,
  LocalQueueMode,
  LocalQueueModes,
  WorkerPoolOptions,
} from ".";
import { MINUTE, SECOND } from "./cronConstants";
import defer, { Deferred } from "./deferred";
import { GetJobFunction, Job, TaskList, WorkerPool } from "./interfaces";
import { coerceError } from "./lib";
import { getJobs as baseGetJobs } from "./sql/getJobs";
import { returnJobs } from "./sql/returnJobs";

const { STARTING, POLLING, WAITING, TTL_EXPIRED, RELEASED } = LocalQueueModes;

/**
 * The local queue exists to reduce strain on the database; it works by
 * fetching a batch of jobs from the database and distributing them to workers
 * as and when necessary. It is also responsible for polling when in use,
 * relieving the workers of this responsibility.
 *
 * The local queue trades latency for throughput: jobs may sit in the local
 * queue for a longer time (maximum `localQueue.size` jobs waiting maximum
 * `localQueue.ttl` milliseconds), but fewer requests to the database are made
 * for jobs since more jobs are fetched at once, enabling the worker to reach
 * higher levels of performance (and reducing read stress on the DB).
 *
 * The local queue is always in one of these modes:
 *
 * - STARTING mode
 * - POLLING mode
 * - WAITING mode
 * - TTL_EXPIRED mode
 * - RELEASED mode
 *
 * ## STARTING mode
 *
 * STARTING mode is the initial state of the local queue.
 *
 * Immediately move to POLLING mode.
 *
 * ## POLLING mode
 *
 * The queue will only be in POLLING mode when it contains no cached jobs.
 *
 * When the queue enters POLLING mode:
 *
 * - if any refetch delay has expired it will trigger a fetch of jobs from the
 *   database,
 * - otherwise it will trigger a refetch to happen once the refetch delay has
 *   completed.
 *
 * When jobs are fetched:
 *
 * - if no jobs were returned then it will wait `pollInterval` ms and then
 *   fetch again.
 * - if fewer than `Math.ceil(Math.min(localQueueRefetchDelay.threshold, localQueueSize))`
 *   jobs were returned then a refetch delay will be set (if configured).
 * - if jobs are returned from a POLLING mode fetch then the queue immediately
 *   enters WAITING mode.
 *
 * When a "new job" notification is received, once any required refetch delay
 * has expired (or immediately if it has already expired) the timer will be
 * cancelled, and a fetch will be fired immediately.
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
  public readonly mode: LocalQueueMode = STARTING;
  /** The promise that resolves/rejects when the queue is disposed of */
  private _finPromise = defer();
  private errors: Error[] = [];
  /** A count of the number of "background" processes such as fetching or returning jobs */
  private backgroundCount = 0;

  /** If `localQueueRefetchDelay` is configured; set this true if the fetch resulted in a queue size lower than the threshold. */
  private refetchDelayActive = false;
  private refetchDelayFetchOnComplete = false;
  private refetchDelayTimer: NodeJS.Timeout | null = null;
  private refetchDelayCounter: number = 0;
  private refetchDelayAbortThreshold: number = Infinity;

  constructor(
    private readonly compiledSharedOptions: CompiledSharedOptions<WorkerPoolOptions>,
    private readonly tasks: TaskList,
    private readonly withPgClient: EnhancedWithPgClient,
    public readonly workerPool: WorkerPool,
    private readonly getJobBatchSize: number,
    private readonly continuous: boolean,
  ) {
    this.ttl =
      compiledSharedOptions.resolvedPreset.worker.localQueue?.ttl ?? 5 * MINUTE;
    this.pollInterval =
      compiledSharedOptions.resolvedPreset.worker.pollInterval ?? 2 * SECOND;
    const localQueueRefetchDelayDuration =
      compiledSharedOptions.resolvedPreset.worker.localQueue?.refetchDelay
        ?.durationMs;
    if (
      localQueueRefetchDelayDuration != null &&
      localQueueRefetchDelayDuration > this.pollInterval
    ) {
      throw new Error(
        `Invalid configuration; 'preset.worker.localQueue.refetchDelay.durationMs' (${localQueueRefetchDelayDuration}) must not be larger than 'preset.worker.pollInterval' (${this.pollInterval})`,
      );
    }
    compiledSharedOptions.events.emit("localQueue:init", {
      localQueue: this,
    });
    this.setModePolling();
  }

  private setMode(
    newMode: Exclude<LocalQueueMode, typeof LocalQueueModes.STARTING>,
  ) {
    const oldMode = this.mode;
    // Override the 'readonly'
    (this.mode as LocalQueueMode) = newMode;
    this.compiledSharedOptions.events.emit("localQueue:setMode", {
      localQueue: this,
      oldMode,
      newMode,
    });
  }

  private fin() {
    assert.equal(this.mode, "RELEASED");
    assert.equal(this.backgroundCount, 0);
    if (this.errors.length === 1) {
      this._finPromise.reject(this.errors[0]);
    } else if (this.errors.length > 1) {
      this._finPromise.reject(new AggregateError(this.errors));
    } else {
      this._finPromise.resolve();
    }
  }

  private decreaseBackgroundCount = () => {
    this.backgroundCount--;
    if (this.mode === "RELEASED" && this.backgroundCount === 0) {
      this.fin();
    }
  };

  private decreaseBackgroundCountWithError = (e: unknown) => {
    this.backgroundCount--;
    if (this.mode === "RELEASED") {
      this.errors.push(coerceError(e));
      if (this.backgroundCount === 0) {
        this.fin();
      }
    } else {
      this.compiledSharedOptions.logger.error(
        `Backgrounding should never yield errors when the queue is not RELEASED`,
        { error: e },
      );
    }
  };

  /**
   * For promises that happen in the background, but that we want to ensure are
   * handled before we release the queue (so that the database pool isn't
   * released too early).
   *
   * IMPORTANT: never raise an error from background unless mode === "RELEASED" - you
   * need to handle errors yourself!
   */
  private background(promise: Promise<void>) {
    if (this.mode === "RELEASED" && this.backgroundCount === 0) {
      throw new Error(
        `Cannot background something when the queue is already released`,
      );
    }
    this.backgroundCount++;
    promise.then(
      this.decreaseBackgroundCount,
      this.decreaseBackgroundCountWithError,
    );
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

    this.setMode(POLLING);

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

    this.setMode(WAITING);

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

    this.setMode(TTL_EXPIRED);

    // Return jobs to the pool
    this.returnJobs();
  }

  private returnJobs() {
    const l = this.jobQueue.length;
    if (l === 0) {
      return;
    }
    const jobsToReturn = this.jobQueue.splice(0, l);
    this.compiledSharedOptions.events.emit("localQueue:returnJobs", {
      localQueue: this,
      jobs: jobsToReturn,
    });
    this.background(
      returnJobs(
        this.compiledSharedOptions,
        this.withPgClient,
        this.workerPool.id,
        jobsToReturn,
      ).then(
        () => {},
        (e) => {
          if (this.mode === "RELEASED") {
            throw new Error(
              `Error occurred whilst returning jobs from local queue to database queue: ${
                coerceError(e).message
              }`,
            );
          } else {
            // Return the jobs to the queue; MUST NOT HAPPEN IN RELEASED MODE.
            this.receivedJobs(jobsToReturn);
            this.compiledSharedOptions.logger.error(
              `Failed to return jobs from local queue to database queue`,
              { error: e },
            );
          }
        },
      ),
    );
  }

  private receivedJobs(jobs: Job[]) {
    const jobCount = jobs.length;
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
  }

  private fetch = (): void => {
    if (this.fetchTimer) {
      clearTimeout(this.fetchTimer);
      this.fetchTimer = null;
    }
    if (this.refetchDelayActive) {
      this.refetchDelayFetchOnComplete = true;
      return;
    }
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
    /**
     * Did we fetch the maximum number of records that we could? (If so, we
     * should consider fetching again straight away so there's always jobs to
     * be done.)
     */
    let fetchedMax = false;
    /**
     * Did we fetch more jobs than the refetch delay threshold? (Greater than,
     * not equal to.) If false, we should start a refetch delay.
     *
     * Initialized to `true` so on error we don't enable refetch delay.
     */
    let refetchDelayThresholdSurpassed = true;
    let jobCount = 0;
    const refetchDelayOptions =
      this.compiledSharedOptions.resolvedPreset.worker.localQueue?.refetchDelay;
    try {
      assert.equal(this.mode, POLLING, "Can only fetch when in polling mode");
      assert.equal(
        this.fetchInProgress,
        false,
        "Cannot fetch when a fetch is already in progress",
      );
      assert.equal(
        this.refetchDelayActive,
        false,
        "Can not fetch when fetches are meant to be delayed",
      );
      assert.equal(
        this.jobQueue.length,
        0,
        "Should not fetch when job queue isn't empty",
      );
      this.fetchAgain = false;
      this.fetchInProgress = true;
      // NOTE: this.refetchDelayCounter is set here allow for pulse() during
      // fetch(). If the refetch delay threshold is surpassed then this value
      // is harmlessly ignored.
      this.refetchDelayCounter = 0;

      // The ONLY await in this function.
      const jobs = await baseGetJobs(
        this.compiledSharedOptions,
        this.withPgClient,
        this.tasks,
        this.workerPool.id,
        null,
        this.getJobBatchSize,
      );

      this.compiledSharedOptions.events.emit("localQueue:getJobs:complete", {
        localQueue: this,
        jobs,
      });

      jobCount = jobs.length;
      fetchedMax = jobCount >= this.getJobBatchSize;
      refetchDelayThresholdSurpassed =
        // If we've fetched the maximum, we've met the requirement
        fetchedMax ||
        // If refetch delay is disabled, we've met the requirement
        !refetchDelayOptions ||
        // If we fetched more than (**not** equal to) `threshold` jobs, we've met the requirement
        jobCount > Math.floor(refetchDelayOptions.threshold ?? 0);

      // NOTE: we don't need to handle `this.mode === RELEASED` here because
      // being in that mode guarantees the workerQueue is empty.
      this.receivedJobs(jobs);
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
      return;
    }

    /** How long to avoid any refetches for */
    const refetchDelayMs =
      (0.5 + Math.random()) * (refetchDelayOptions?.durationMs ?? 100);
    if (!refetchDelayThresholdSurpassed) {
      /** The configured abort threshold */
      const maxAbortThreshold =
        refetchDelayOptions?.maxAbortThreshold ?? 5 * this.getJobBatchSize;
      /**
       * How many notifications do we need to receive before we abort the "no
       * refetches" behavior? Note: this is not
       */
      const abortThreshold =
        // `|| Infinity` because if `maxAbortThreshold = Infinity` and
        // `Math.random() = 0` then we'd get `NaN` (`0 * Infinity = NaN`)
        Math.random() * maxAbortThreshold || Infinity;

      this.fetchAgain = false;
      this.refetchDelayActive = true;
      this.refetchDelayFetchOnComplete = false;
      this.refetchDelayAbortThreshold = abortThreshold;
      // NOTE: this.refetchDelayCounter is set at the beginning of fetch()
      // (i.e. above) to allow for pulse() during fetch()
      this.refetchDelayTimer = setTimeout(
        this.refetchDelayCompleteOrAbort,
        refetchDelayMs,
      );
      this.compiledSharedOptions.events.emit("localQueue:refetchDelay:start", {
        localQueue: this,
        jobCount,
        threshold: refetchDelayOptions?.threshold ?? 0,
        delayMs: refetchDelayMs,
        abortThreshold: this.refetchDelayAbortThreshold,
      });
    }

    if (this.jobQueue.length > 0) {
      this.setModeWaiting();
    } else {
      if (fetchedMax || this.fetchAgain) {
        // Maximal fetch and all jobs instantly consumed; trigger immediate refetch
        // OR: new jobs came in during fetch(); trigger immediate refetch
        assert.equal(
          this.refetchDelayActive,
          false,
          "refetchDelayActive should imply didn't fetch max and fetchAgain is false",
        );
        this.fetch();
      } else if (this.continuous) {
        // Set up the timer
        this.fetchTimer = setTimeout(this.fetch, this.pollInterval);
      } else {
        this.setModeReleased();
        return;
      }
    }

    // In case the counter was incremented sufficiently during fetch()
    this.handleCheckRefetchDelayAbortThreshold();
  }

  private refetchDelayCompleteOrAbort = (aborted = false): void => {
    if (this.refetchDelayTimer != null) {
      clearTimeout(this.refetchDelayTimer);
      this.refetchDelayTimer = null;
    }
    this.refetchDelayActive = false;
    if (aborted) {
      this.compiledSharedOptions.events.emit("localQueue:refetchDelay:abort", {
        localQueue: this,
        count: this.refetchDelayCounter,
        abortThreshold: this.refetchDelayAbortThreshold,
      });
    } else {
      this.compiledSharedOptions.events.emit(
        "localQueue:refetchDelay:expired",
        {
          localQueue: this,
        },
      );
    }

    if (this.mode === POLLING && this.refetchDelayFetchOnComplete) {
      // Cancel poll, do now
      if (this.fetchTimer) {
        clearTimeout(this.fetchTimer);
        this.fetchTimer = null;
      }
      this.fetch();
    }
  };

  /**
   * If no refetch delay is active, returns false; otherwise returns true and
   * checks to see if we need to abort the delay and trigger a fetch.
   */
  private handleCheckRefetchDelayAbortThreshold(): boolean {
    if (!this.refetchDelayActive || this.mode === "RELEASED") {
      return false;
    }
    if (this.refetchDelayCounter >= this.refetchDelayAbortThreshold) {
      this.refetchDelayFetchOnComplete = true;
      this.refetchDelayCompleteOrAbort(true);
    }
    return true;
  }

  /** Called when a new job becomes available in the DB */
  public pulse(count: number) {
    this.refetchDelayCounter += count;

    if (this.handleCheckRefetchDelayAbortThreshold()) {
      // Refetch delay was enabled; we've incremented the counter and taken
      // action if necessary. No further action necessary.
    } else if (this.mode === POLLING) {
      if (this.fetchInProgress) {
        this.fetchAgain = true;
      } else if (this.fetchTimer != null) {
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
      const jobsPromise = baseGetJobs(
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
    return this._finPromise;
  }

  private setModeReleased() {
    const oldMode = this.mode;
    assert.notEqual(oldMode, RELEASED, "LocalQueue must only be released once");
    this.setMode(RELEASED);

    if (this.refetchDelayTimer != null) {
      clearTimeout(this.refetchDelayTimer);
      this.refetchDelayTimer = null;
    }
    this.refetchDelayActive = false;

    switch (oldMode) {
      case POLLING: {
        // Release pending workers
        const futureJobs = this.workerQueue.splice(0, this.workerQueue.length);
        futureJobs.forEach((futureJob) => futureJob.resolve(undefined));

        // Release next fetch call
        if (this.fetchTimer != null) {
          // No need to return jobs in POLLING mode
          clearTimeout(this.fetchTimer);
          this.fetchTimer = null;
        } else {
          // There's a fetch in progress, so backgroundCount will not be 0, and
          // fetch handles calling returnJobs if it completes when in RELEASED
          // mode.
        }

        break;
      }
      case WAITING: {
        if (this.ttlExpiredTimer) {
          clearTimeout(this.ttlExpiredTimer);
          this.ttlExpiredTimer = null;
        }
        // Trigger the jobs to be released
        // NOTE: this will add to backgroundCount
        this.returnJobs();
        break;
      }
      case TTL_EXPIRED: {
        // No action necessary, jobs are already returned
        break;
      }
      case STARTING: {
        // From STARTING to RELEASED directly? This should never happen!
        break;
      }
      case RELEASED: {
        // Explicitly ruled against via assertion above.
        break;
      }
      default: {
        const never: never = oldMode;
        throw new Error(`Unhandled mode: ${never}`);
      }
    }

    if (this.backgroundCount === 0) {
      this.fin();
    }
  }
}
