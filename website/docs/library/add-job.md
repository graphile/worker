---
title: "addJob()"
---

The `addJob` API exists in many places in graphile-worker, but all the instances
have exactly the same call signature. The API is used to add a job to the queue
for immediate or delayed execution. With `jobKey` and `jobKeyMode` it can also
be used to replace existing jobs.

:::note

`quickAddJob` is similar to `addJob`, but accepts an additional initial
parameter describing how to connect to the database.

:::

The `addJob` arguments are as follows:

- `identifier`: the name of the task to be executed
- `payload`: an optional JSON-compatible object to give the task more context on
  what it is doing, or a list of these objects in &ldquo;batch job&rdquo; mode
- `options`: an optional object specifying:
  - `queueName`: the queue to run this task under
  - `runAt`: a `Date` to schedule this task to run in the future
  - `maxAttempts`: how many retries should this task get? (Default: 25)
  - `jobKey`: unique identifier for the job, used to replace, update or remove
    it later if needed (see
    [Replacing and updating jobs](../job-key.md#replacingupdating-jobs) and
    [removing jobs](../job-key.md#removing-jobs)); can be used for
    de-duplication (i.e. throttling or debouncing)
  - `jobKeyMode`: controls the behavior of `jobKey` when a matching job is found
    (see [Replacing and updating jobs](../job-key.md#replacingupdating-jobs) and
    [removing jobs](../job-key.md#removing-jobs))

Example:

```js
await addJob("send_email", { to: "someone@example.com" });
```

Definitions:

```ts
export type AddJobFunction = (
  /**
   * The name of the task that will be executed for this job.
   */
  identifier: string,

  /**
   * The payload (typically a JSON object) that will be passed to the task executor.
   */
  payload: unknown,

  /**
   * Additional details about how the job should be handled.
   */
  spec?: TaskSpec,
) => Promise<Job>;

export interface TaskSpec {
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
   * How many attempts should this task get? The minimum is 1, in which case the
   * task will only be attempted once and won't be retried. (Default: 25)
   */
  maxAttempts?: number;

  /**
   * Unique identifier for the job, can be used to update or remove it later if
   * needed. (Default: null)
   */
  jobKey?: string;

  /**
   * Modifies the behavior of `jobKey`; when 'replace' all attributes will be
   * updated, when 'preserve_run_at' all attributes except 'run_at' will be
   * updated, when 'unsafe_dedupe' a new job will only be added if no existing
   * job (including locked jobs and permanently failed jobs) with matching job
   * key exists. (Default: 'replace')
   */
  jobKeyMode?: "replace" | "preserve_run_at" | "unsafe_dedupe";

  /**
   * Flags for the job, can be used to dynamically filter which jobs can and
   * cannot run at runtime. (Default: null)
   */
  flags?: string[];
}
```

### Batch jobs

Normally a job&apos;s `payload` is an object; however we also allow for jobs to
have a `payload` that is an array of objects. When `payload` is an array of
objects, we call this a &ldquo;batch job&rdquo; and it has a few special
behaviors:

1. when you use `job_key` in `replace` or `preserve_run_at` mode, when a job is
   replaced/updated, instead of overwriting the payload, the existing and new
   payloads will be merged into a larger array (this only occurs when the
   existing and new payloads are both arrays, otherwise the payload is simply
   replaced).
2. when a task executes a batch job, it may return a list of promises that is
   the same length as the payload array. If any of these promises reject, then
   the job is said to have &ldquo;partial success&rdquo;, the result of which is
   it being sent back to the queue for a retry, but with the successful objects
   removed from the payload so only the failed objects will be retried.

Batch jobs can be useful where you need to aggregate multiple tasks together
over time for efficiency; for example if you have a notification system you
might schedule a notification to be sent to a user in 2 minutes time that they
received a DM. Over the next 2 minutes if any other DMs are received, these can
be appended to the job payload such that when the job executes it can inform the
user of all of these DMs, not just the latest one.
