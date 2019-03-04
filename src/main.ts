import { Pool, PoolClient } from "pg";
import { TaskList, Worker, Job } from "./interfaces";
import debug from "./debug";
import deferred from "./deferred";
import SIGNALS from "./signals";
import { makeNewWorker } from "./worker";

let shuttingDown = false;
debug("Booting worker");

function makeWithPgClientFromPool(pgPool: Pool) {
  return async <T>(callback: (pgClient: PoolClient) => Promise<T>) => {
    const client = await pgPool.connect();
    try {
      return await callback(client);
    } finally {
      await client.release();
    }
  };
}

function makeWithPgClientFromClient(pgClient: PoolClient) {
  return async <T>(callback: (pgClient: PoolClient) => Promise<T>) => {
    return callback(pgClient);
  };
}

export function start(tasks: TaskList, pgPool: Pool, workerCount = 1) {
  const promise = deferred();
  // Make sure we clean up after ourselves
  async function gracefulShutdown(signal: string) {
    // Release all jobs
    try {
      const workerIds = workers.map(worker => worker.workerId);
      const jobsInProgress: Array<Job> = workers
        .map(worker => worker.getActiveJob())
        .filter((job): job is Job => !!job);
      debug("RELEASING THE JOBS", workerIds);
      const { rows: cancelledJobs } = await pgPool.query(
        `
          SELECT graphile_worker.fail_job(job_queues.locked_by, jobs.id, $2)
          FROM graphile_worker.jobs
          INNER JOIN graphile_worker.job_queues ON (job_queues.queue_name = jobs.queue_name)
          WHERE job_queues.locked_by = ANY($1::text[]) AND jobs.id = ANY($3::int[]);
        `,
        [
          workerIds,
          `Forced worker shutdown due to ${signal}`,
          jobsInProgress.map(job => job.id)
        ]
      );
      debug(cancelledJobs);
      debug("JOBS RELEASED");
    } catch (e) {
      console.error(e.message); // tslint:disable-line no-console
    }
  }

  SIGNALS.forEach(signal => {
    debug("Registering signal handler for ", signal);
    const removeHandler = () => {
      debug("Removing signal handler for ", signal);
      process.removeListener(signal, handler);
    };
    const handler = function() {
      // tslint:disable-next-line no-console
      console.error(`Received '${signal}'; attempting graceful shutdown...`);
      setTimeout(removeHandler, 5000);
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      gracefulShutdown(signal).finally(() => {
        removeHandler();
        // tslint:disable-next-line no-console
        console.error(
          `Graceful shutdown attempted; killing self via ${signal}`
        );
        process.kill(process.pid, signal);
      });
    };
    process.on(signal, handler);
  });

  // Okay, start working
  const workers: Array<Worker> = [];
  const listenForChanges = (
    err: Error | undefined,
    client: PoolClient,
    release: () => void
  ) => {
    if (err) {
      // tslint:disable-next-line no-console
      console.error(
        `Error connecting with notify listener (trying again in 5 seconds): ${
          err.message
        }`
      );
      // Try again in 5 seconds
      setTimeout(() => {
        pgPool.connect(listenForChanges);
      }, 5000);
      return;
    }
    client.on("notification", () => {
      // Find a worker that's available
      workers.some(worker => worker.nudge());
    });

    // Subscribe to jobs:insert message
    client.query('LISTEN "jobs:insert"');

    // On error, release this client and try again
    client.on("error", (e: Error) => {
      // tslint:disable-next-line no-console
      console.error("Error with database notify listener", e.message);
      release();
      pgPool.connect(listenForChanges);
    });

    const supportedTaskNames = Object.keys(tasks);
    // tslint:disable-next-line no-console
    console.log(
      `Worker connected and looking for jobs... (task names: '${supportedTaskNames.join(
        "', '"
      )}')`
    );
  };
  pgPool.connect(listenForChanges);

  const withPgClient = makeWithPgClientFromPool(pgPool);
  for (let i = 0; i < workerCount; i++) {
    workers.push(makeNewWorker(tasks, withPgClient));
  }

  return {
    release: () => {
      promise.resolve();
      return Promise.all(workers.map(worker => worker.release()));
    },
    promise
  };
}

export const runAllJobs = (tasks: TaskList, client: PoolClient) =>
  makeNewWorker(tasks, makeWithPgClientFromClient(client), false).promise;
