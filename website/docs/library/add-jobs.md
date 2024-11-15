---
title: "addJobs()"
---

:::caution Experimental

This API may change in a semver minor release.

:::

The `addJobs` APIs exists in many places in graphile-worker, but all the
instances have exactly the same call signature. The API is used to efficiently
add a batch of jobs to the queue for immediate or delayed execution. With
`jobKey` it can also be used to replace existing jobs.

:::note

The `addJobs()` JavaScript method simply defers to the underlying
[`addJobs`](../sql-add-job.md#graphile_workeradd_jobs) SQL function.

:::

The `addJobs` arguments are as follows:

- `jobSpecs`: descriptions of the jobs you want to queue
- `jobKeyPreserveRunAt`: optional boolean; if true, `run_at` will not be updated
  when a job is overwritten due to `jobKey`

Example:

```js
await addJobs([
  { identifier: "send_email", payload: { to: "someone@example.com" } },
]);
```

Definitions:

```ts
export type AddJobsFunction = (
  jobSpecs: AddJobsJobSpec[],
  jobKeyPreserveRunAt?: boolean,
) => Promise<ReadonlyArray<Job>>;

export interface AddJobsJobSpec {
  /**
   * The name of the task that will be executed for this job.
   */
  identifier: string;

  /**
   * The payload (typically a JSON object) that will be passed to the task executor.
   */
  payload: unknown;

  /**
   * The queue to run this task under (only specify if you want jobs in this
   * queue to run serially). (Default: null)
   */
  queueName?: string;

  /**
   * A Date to schedule this task to run in the future. (Default: now)
   */
  runAt?: Date;

  /**
   * Jobs are executed in numerically ascending order of priority (jobs with a
   * numerically smaller priority are run first). (Default: 0)
   */
  priority?: number;

  /**
   * How many retries should this task get? (Default: 25)
   */
  maxAttempts?: number;

  /**
   * Unique identifier for the job, can be used to update or remove it later if
   * needed. (Default: null)
   */
  jobKey?: string;

  /**
   * Flags for the job, can be used to dynamically filter which jobs can and
   * cannot run at runtime. (Default: null)
   */
  flags?: string[];
}
```
