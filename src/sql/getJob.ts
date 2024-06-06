import { DbJob, EnhancedWithPgClient, Job, TaskList } from "../interfaces";
import { CompiledSharedOptions } from "../lib";
import { getTaskDetails } from "../taskIdentifiers";

export function isPromise<T>(t: T | Promise<T>): t is Promise<T> {
  return (
    typeof t === "object" &&
    t !== null &&
    typeof (t as Promise<unknown>).then === "function" &&
    typeof (t as Promise<unknown>).catch === "function"
  );
}

export async function getJob(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: EnhancedWithPgClient,
  tasks: TaskList,
  poolId: string,
  flagsToSkip: string[] | null,
  rawBatchSize: number,
): Promise<Job[]> {
  const batchSize = parseInt(String(rawBatchSize), 10) || 1;
  const {
    escapedWorkerSchema,
    workerSchema,
    resolvedPreset: {
      worker: { preparedStatements, useNodeTime },
    },
    logger,
  } = compiledSharedOptions;

  const taskDetailsPromise = getTaskDetails(
    compiledSharedOptions,
    withPgClient,
    tasks,
  );
  const taskDetails = isPromise(taskDetailsPromise)
    ? await taskDetailsPromise
    : taskDetailsPromise;

  if (taskDetails.taskIds.length === 0) {
    logger.error("No tasks found; nothing to do!");
    return [];
  }

  let i = 2;
  const hasFlags = flagsToSkip && flagsToSkip.length > 0;
  const flagsClause = hasFlags
    ? `and ((flags ?| $${++i}::text[]) is not true)`
    : "";
  const now = useNodeTime ? `$${++i}::timestamptz` : "now()";

  /**
   * The 'named queue' strategy to use.
   *
   * 0 - we're not using named queues; skip them!
   * 1 - for each matched job, go lock its job queue if you can
   * 2 - lock the job queues up front, then find a job to do
   * 3 - explicitly avoid locked job queues, but risk multiple jobs in same queue running at same time
   *
   * Strategy 0 is what you should use if you never use named queues; it's the
   * absolute fastest strategy. But if you use named queues, you must have at
   * least one worker using a non-zero strategy.
   *
   * Strategy 1 is what Worker traditionally used; it's the best strategy if
   * you have a different queue name for every job (as worker did before we
   * made queue_name nullable), but these days its a terrible strategy unless
   * you're still randomly generating queue names (don't do that!). Performance
   * is abysmal if you have a large jobs table with many higher priority but stuck
   * jobs.
   *
   * Strategy 2 seems to be the fastest strategy for jobs that aren't in a
   * queue when you have a small number of named queues that can be locked from
   * time to time.
   *
   * Strategy 3 is probably unsafe. Don't use it.
   *
   * With 100,000 stuck jobs across two named queues and 50,000 lower
   * precedence jobs that are not in named queues and are ready to go, I got
   * the following results from the benchmark:
   *
   * Strat 0 (cheating) - 11.8kjps - actually better than the perf if there were no stuck jobs
   * Strat 1 - roughly 40jps (I got bored waiting for the test to finish)
   * Strat 2 - 843jps
   * Strat 3 (unsafe) - 600jps
   *
   * I recommend you either use strat 0 if you can, or strat 2 otherwise.
   */
  const strategy: number = 2;
  const queueClause =
    strategy === 0
      ? `and jobs.job_queue_id is null`
      : strategy === 1
      ? `and (
      jobs.job_queue_id is null
      or exists (
        select 1
        from ${escapedWorkerSchema}._private_job_queues as job_queues
        where job_queues.id = jobs.job_queue_id
        and job_queues.is_available = true
        for update
        skip locked
      )
    )`
      : strategy === 2
      ? `and (
      jobs.job_queue_id is null
      or
      jobs.job_queue_id in (
        select id
        from ${escapedWorkerSchema}._private_job_queues as job_queues
        where job_queues.is_available = true
        for update
        skip locked
      )
    )`
      : `and (
      jobs.job_queue_id is null
      or
      jobs.job_queue_id not in (
        select id
        from ${escapedWorkerSchema}._private_job_queues as job_queues
        where job_queues.is_available = false
      )
    )`;
  /* This strategy causes incredibly bad performance, presumably due to the
   * lack of lock/skip locked:
      `and (
      jobs.job_queue_id is null
      or
      jobs.job_queue_id in (
        select id
        from ${escapedWorkerSchema}._private_job_queues as job_queues
        where job_queues.is_available = true
      )
    )`
    */

  const updateQueue =
    strategy === 0
      ? ""
      : `,
q as (
  update ${escapedWorkerSchema}._private_job_queues as job_queues
    set
      locked_by = $1::text,
      locked_at = ${now}
    from j
    where job_queues.id = j.job_queue_id
)`;

  const text = `\
with j as (
  select jobs.job_queue_id, jobs.priority, jobs.run_at, jobs.id
    from ${escapedWorkerSchema}._private_jobs as jobs
    where jobs.is_available = true
    and run_at <= ${now}
    and task_id = any($2::int[])
    ${queueClause}
    ${flagsClause}
    order by priority asc, run_at asc
    limit ${batchSize}
    for update
    skip locked
)${updateQueue}
  update ${escapedWorkerSchema}._private_jobs as jobs
    set
      attempts = jobs.attempts + 1,
      locked_by = $1::text,
      locked_at = ${now}
    from j
    where jobs.id = j.id
    returning *`;
  // TODO: breaking change; change this to more optimal:
  // `RETURNING id, job_queue_id, task_id, payload`,
  const values = [
    poolId,
    taskDetails.taskIds,
    ...(hasFlags ? [flagsToSkip!] : []),
    ...(useNodeTime ? [new Date().toISOString()] : []),
  ];
  const name = !preparedStatements
    ? undefined
    : `get_job${batchSize === 1 ? "" : batchSize}${hasFlags ? "F" : ""}${
        useNodeTime ? "N" : ""
      }/${workerSchema}`;

  const { rows } = await withPgClient.withRetries((client) =>
    client.query<DbJob>({
      text,
      values,
      name,
    }),
  );
  return rows.reverse().map((jobRow) =>
    Object.assign(jobRow, {
      task_identifier:
        taskDetails.supportedTaskIdentifierByTaskId[jobRow.task_id],
    }),
  );
}
