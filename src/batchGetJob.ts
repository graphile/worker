import {
  CompiledSharedOptions,
  EnhancedWithPgClient,
  WorkerPoolOptions,
} from ".";
import { GetJobFunction, Job, TaskList, WorkerPool } from "./interfaces";
import { getJob as baseGetJob } from "./sql/getJob";

export function makeBatchGetJob(
  compiledSharedOptions: CompiledSharedOptions<WorkerPoolOptions>,
  tasks: TaskList,
  withPgClient: EnhancedWithPgClient,
  workerPool: WorkerPool,
  getJobBatchSize: number,
): GetJobFunction {
  let getJobCounter = 0;
  let jobQueue: Job[] = [];
  let nextJobs: Promise<boolean> | null = null;
  let getJobBaseline = 0;
  const getJob: GetJobFunction = async (workerId, flagsToSkip) => {
    // Cannot batch if there's flags
    if (flagsToSkip !== null) {
      const jobs = await baseGetJob(
        compiledSharedOptions,
        withPgClient,
        tasks,
        workerPool.id,
        flagsToSkip,
        1,
      );
      return jobs[0];
    }

    const job = jobQueue.pop();
    if (job !== undefined) {
      return job;
    } else {
      return batchGetJob(++getJobCounter);
    }
  };

  const batchGetJob = async (myFetchId: number): Promise<Job | undefined> => {
    // TODO rewrite this so that if we have batch size of 1 we'll still fetch newer jobs in parallel (not queued)
    if (!nextJobs) {
      // Queue is empty, no fetch of jobs in progress; let's fetch them.
      getJobBaseline = getJobCounter;
      nextJobs = (async () => {
        try {
          const jobs = await baseGetJob(
            compiledSharedOptions,
            withPgClient,
            tasks,
            workerPool.id,
            null,
            getJobBatchSize,
          );
          jobQueue = jobs.reverse();
          return jobs.length >= getJobBatchSize;
        } finally {
          nextJobs = null;
        }
      })();
    }
    const fetchedMax = await nextJobs;
    const job = jobQueue.pop();
    if (job) {
      return job;
    } else if (fetchedMax || myFetchId > getJobBaseline) {
      // Either we fetched as many jobs as we could and there still weren't
      // enough, or we requested a job after the request for jobs was sent to
      // the database. Either way, let's fetch again.
      return batchGetJob(myFetchId);
    } else {
      return undefined;
    }
  };

  return getJob;
}
