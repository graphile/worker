import { Pool, PoolClient } from "pg";
import debugFactory from "debug";
import { Helpers, TaskList, Worker, Job } from "./interfaces";

/*
 * idleDelay: This is how long to wait between polling for jobs.
 *
 * Note: this does NOT need to be short, because we use LISTEN/NOTIFY to be
 * notified when new jobs are added - this is just used in the case where
 * LISTEN/NOTIFY fails for whatever reason.
 */
const idleDelay = 15000;

const debug = debugFactory("worker");

let shuttingDown = false;
const jobsInProgress: Array<number> = [];
debug("Booting worker");

function fakePgPool(client: PoolClient): Pool {
  // Only really intended for usage during testing!
  const fakeQuery = (arg1: any, ...args: Array<any>) =>
    client.query(arg1, ...args);
  return ({
    connect: () => ({
      query: fakeQuery,
      release: () => {}
    }),
    query: fakeQuery
  } as any) as Pool;
}

export function makeNewWorker(
  tasks: TaskList,
  pgPool: Pool,
  client: PoolClient,
  continuous = true,
  workerId = `worker-${Math.random()}`
): Worker {
  let doNextTimer: NodeJS.Timer | undefined;

  debug(`!!! Worker '${workerId}' spawned`);

  const doNext = async (): Promise<null> => {
    if (!continuous && process.env.NODE_ENV !== "test") {
      throw new Error(
        "Continuous should always be true except in a test environment"
      );
    }
    if (shuttingDown) {
      return null;
    }
    if (doNextTimer) {
      clearTimeout(doNextTimer);
    }
    doNextTimer = undefined;
    try {
      const supportedTaskNames = Object.keys(tasks);
      const {
        rows: [jobRow]
      } = await client.query("SELECT * FROM graphile_worker.get_job($1, $2);", [
        workerId,
        supportedTaskNames
      ]);
      const job = jobRow as Job;
      if (!job || !job.id) {
        if (continuous) {
          doNextTimer = setTimeout(() => doNext(), idleDelay);
        }
        return null;
      }
      jobsInProgress.push(job.id);
      debug(
        `Found task ${job.id} (${job.task_identifier}); worker ${workerId}`
      );
      const startTimestamp = process.hrtime();
      const worker = tasks[job.task_identifier];
      if (!worker) {
        throw new Error("Unsupported task");
      }
      const helpers: Helpers = {
        debug: debugFactory(`worker:${job.task_identifier}`),
        pgPool
        // You can give your workers more context here if you like.
      };
      let err;
      try {
        await worker(job, helpers);
      } catch (error) {
        err = error;
      }
      const durationRaw = process.hrtime(startTimestamp);
      const duration = ((durationRaw[0] * 1e9 + durationRaw[1]) / 1e6).toFixed(
        2
      );
      try {
        if (err) {
          // tslint:disable-next-line no-console
          console.error(
            `Failed task ${job.id} (${job.task_identifier}) with error ${
              err.message
            } (${duration}ms)`,
            { err, stack: err.stack }
          );
          // tslint:disable-next-line no-console
          console.error(err.stack);
          await client.query(
            "SELECT * FROM graphile_worker.fail_job($1, $2, $3);",
            [workerId, job.id, err.message]
          );
        } else {
          // tslint:disable-next-line no-console
          console.log(
            `Completed task ${job.id} (${
              job.task_identifier
            }) with success (${duration}ms)`
          );
          await client.query(
            "SELECT * FROM graphile_worker.complete_job($1, $2);",
            [workerId, job.id]
          );
        }
      } catch (fatalError) {
        const when = err ? `after failure '${err.message}'` : "after success";
        // tslint:disable-next-line no-console
        console.error(
          `Failed to release job '${job.id}' ${when}; committing seppuku`
        );
        // tslint:disable-next-line no-console
        console.error(fatalError.message);
        if (continuous) {
          process.exit(1);
        }
      }
      const idx = jobsInProgress.indexOf(job.id);
      if (idx >= 0) {
        jobsInProgress.splice(idx, 1);
      }
      return doNext();
    } catch (err) {
      if (continuous) {
        debug(`ERROR! ${err.message}`);
        doNextTimer = setTimeout(() => doNext(), idleDelay);
        return null;
      } else {
        throw err;
      }
    }
  };

  const nudge = () => {
    if (doNextTimer) {
      // Must be idle
      doNext();
      return true;
    }
    return false;
  };

  return { doNext, nudge, workerId };
}

export async function start(tasks: TaskList, pgPool: Pool, workerCount = 1) {
  // Make sure we clean up after ourselves
  const workerIds: Array<string> = [];
  async function gracefulShutdown(signal: string) {
    // Release all jobs
    try {
      debug("RELEASING THE JOBS", workerIds);
      const { rows: cancelledJobs } = await pgPool.query(
        `
          SELECT graphile_worker.fail_job(job_queues.locked_by, jobs.id, $2)
          FROM graphile_worker.jobs
          INNER JOIN graphile_worker.job_queues ON (job_queues.queue_name = jobs.queue_name)
          WHERE job_queues.locked_by = ANY($1::text[]) AND jobs.id = ANY($3::int[]);
        `,
        [workerIds, `Forced worker shutdown due to ${signal}`, jobsInProgress]
      );
      debug(cancelledJobs);
      debug("JOBS RELEASED");
    } catch (e) {
      // tslint:disable-next-line no-console
      console.error(e);
    }
  }

  (["SIGUSR2", "SIGINT", "SIGTERM", "SIGPIPE", "SIGHUP", "SIGABRT"] as Array<
    "SIGUSR2" | "SIGINT" | "SIGTERM" | "SIGPIPE" | "SIGHUP" | "SIGABRT"
  >).forEach(signal => {
    debug("Registering signal handler for ", signal);
    const handler = function() {
      setTimeout(() => {
        process.removeListener(signal, handler);
      }, 5000);
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      gracefulShutdown(signal).finally(() => {
        process.removeListener(signal, handler);
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
      console.error("Error connecting with notify listener", err.message);
      // Try again in 5 seconds
      setTimeout(() => {
        pgPool.connect(listenForChanges);
      }, 5000);
      return;
    }
    client.on("notification", () => {
      workers.some(worker => worker.nudge());
    });
    client.query('LISTEN "jobs:insert"');
    client.on("error", (e: Error) => {
      // tslint:disable-next-line no-console
      console.error("Error with database notify listener", e.message);
      release();
      pgPool.connect(listenForChanges);
    });
    const supportedTaskNames = Object.keys(tasks);
    // tslint:disable-next-line no-console
    console.log(
      "Worker connected and looking for jobs...\n" +
        `  - Supported task names: '${supportedTaskNames.join("', '")}'`
    );
  };
  pgPool.connect(listenForChanges);
  for (let i = 0; i < workerCount; i++) {
    // TODO: reuse listenForChanges client
    const workerClient = await pgPool.connect();
    const worker = makeNewWorker(tasks, pgPool, workerClient);
    workers.push(worker);
    workerIds.push(worker.workerId);
    worker.doNext();
  }
}

export const runAllJobs = (tasks: TaskList, client: PoolClient) =>
  makeNewWorker(tasks, fakePgPool(client), client, false).doNext();
