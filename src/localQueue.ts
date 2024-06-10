import {
  CompiledSharedOptions,
  EnhancedWithPgClient,
  WorkerPoolOptions,
} from ".";
import { GetJobFunction, Job, TaskList, WorkerPool } from "./interfaces";
import { getJob as baseGetJob } from "./sql/getJob";

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
 */

export class LocalQueue {
  getJobCounter = 0;
  jobQueue: Job[] = [];
  nextJobs: Promise<boolean> | null = null;
  getJobBaseline = 0;

  constructor(
    private compiledSharedOptions: CompiledSharedOptions<WorkerPoolOptions>,
    private tasks: TaskList,
    private withPgClient: EnhancedWithPgClient,
    private workerPool: WorkerPool,
    private getJobBatchSize: number,
  ) {}

  // If you refactor this to be a method rather than a property, make sure that you `.bind(this)` to it.
  public getJob: GetJobFunction = async (workerId, flagsToSkip) => {
    // Cannot batch if there's flags
    if (flagsToSkip !== null) {
      const jobs = await baseGetJob(
        this.compiledSharedOptions,
        this.withPgClient,
        this.tasks,
        this.workerPool.id,
        flagsToSkip,
        1,
      );
      return jobs[0];
    }

    const job = this.jobQueue.pop();
    if (job !== undefined) {
      return job;
    } else {
      return this.batchGetJob(++this.getJobCounter);
    }
  };

  private async batchGetJob(myFetchId: number): Promise<Job | undefined> {
    // TODO rewrite this so that if we have batch size of 1 we'll still fetch newer jobs in parallel (not queued)
    if (!this.nextJobs) {
      // Queue is empty, no fetch of jobs in progress; let's fetch them.
      this.getJobBaseline = this.getJobCounter;
      this.nextJobs = (async () => {
        try {
          const jobs = await baseGetJob(
            this.compiledSharedOptions,
            this.withPgClient,
            this.tasks,
            this.workerPool.id,
            null,
            this.getJobBatchSize,
          );
          this.jobQueue = jobs.reverse();
          return jobs.length >= this.getJobBatchSize;
        } finally {
          this.nextJobs = null;
        }
      })();
    }
    const fetchedMax = await this.nextJobs;
    const job = this.jobQueue.pop();
    if (job) {
      return job;
    } else if (fetchedMax || myFetchId > this.getJobBaseline) {
      // Either we fetched as many jobs as we could and there still weren't
      // enough, or we requested a job after the request for jobs was sent to
      // the database. Either way, let's fetch again.
      return this.batchGetJob(myFetchId);
    } else {
      return undefined;
    }
  }
}
