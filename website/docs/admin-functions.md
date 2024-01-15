---
title: "Administrative functions"
sidebar_position: 100
---

When implementing an administrative UI you may need more control over the jobs.
For this we have added a few administrative functions that can be called in SQL
or through the JS API. The JS API is exposed via a `WorkerUtils` instance; see
[`makeWorkerUtils`](/docs/library/queue#makeworkerutils).

:::warning

If you choose to run `UPDATE` or `DELETE` commands against the underlying
tables, be sure to _NOT_ manipulate jobs that are locked as this could have
unintended consequences. The following administrative functions will
automatically ensure that the jobs are not locked before applying any changes.

:::

:::info

These methods are not meant to be called on the currently running job from
inside the job itself; they are administration functions intended to be called
externally. Unless otherwise noted, these functions ignore locked jobs (which
includes all currently running jobs).

:::

## Complete jobs

```sql title="SQL API"
SELECT * FROM graphile_worker.complete_jobs(ARRAY[7, 99, 38674, ...]);
```

```ts title="JS API"
const deletedJobs = await workerUtils.completeJobs([7, 99, 38674, ...]);
```

Marks the specified jobs (by their ids) as if they were completed, assuming they
are not locked. Note that completing a job deletes it. You may mark failed and
permanently failed jobs as completed if you wish. The deleted jobs will be
returned (note that this may be fewer jobs than you requested).

## Permanently fail jobs

```sql title="SQL API"
SELECT * FROM graphile_worker.permanently_fail_jobs(ARRAY[7, 99, 38674, ...], 'Enter reason here');
```

```ts title="JS API"
const updatedJobs = await workerUtils.permanentlyFailJobs([7, 99, 38674, ...], 'Enter reason here');
```

Marks the specified jobs (by their ids) as failed permanently, assuming they are
not locked. This means setting their `attempts` equal to their `max_attempts`.
The updated jobs will be returned (note that this may be fewer jobs than you
requested).

## Rescheduling jobs

```sql title="SQL API"
SELECT * FROM graphile_worker.reschedule_jobs(
  ARRAY[7, 99, 38674, ...],
  run_at := NOW() + interval '5 minutes',
  priority := 5,
  attempts := 5,
  max_attempts := 25
);
```

```ts title="JS API"
const updatedJobs = await workerUtils.rescheduleJobs(
  [7, 99, 38674, ...],
  {
    runAt: '2020-02-02T02:02:02Z',
    priority: 5,
    attempts: 5,
    maxAttempts: 25
  }
);
```

Updates the specified scheduling properties of the jobs (assuming they are not
locked). All of the specified options are optional, omitted or null values will
left unmodified.

This method can be used to postpone or advance job execution, or to schedule a
previously failed or permanently failed job for execution. The updated jobs will
be returned (note that this may be fewer jobs than you requested).

## Force unlock workers

(Since v0.16)

If a worker crashes or is otherwise terminated without unlocking its jobs, then
those jobs will remain locked for 4 hours before they can be re-attempted. If
you have a system in place that can determine this has happened (for example a
heartbeat server, or the process that runs Graphile Worker notices that it has
exited) then you can use the "force unlock workers" functionality to unlock all
of the jobs from the given list of worker IDs.

```sql title="SQL API"
SELECT graphile_worker.force_unlock_workers(ARRAY[
  'worker-0d069f0d6be41d1adb',
  'worker-cd357d05e3382cd169'
]);
```

```ts title="JS API"
await workerUtils.forceUnlockWorkers([
  "worker-0d069f0d6be41d1adb",
  "worker-cd357d05e3382cd169",
]);
```

:::warning

The **only** legitimate reason to manually unlock a job is if the worker has
crashed/died/exited/ceased to exist; in all other cases it's almost certainly
the wrong thing to do. That is why this method relates to unlocking any jobs
from the given list of crashed workers (rather than unlocking jobs directly via
their IDs/keys). Do **NOT** pass any alive worker ids to this method or Bad
Things may happen.

:::

## Database cleanup

Over time it's likely that graphile_worker's tables will grow with stale values
for old job queue names, task identifiers, or permanently failed jobs. You can
clean up this stale information with the cleanup function, indicating which
cleanup operations you would like to undertake.

:::tip

If you find yourself calling this quite often or on a schedule, it's likely that
you are doing something wrong (e.g. allowing jobs to permafail, using random
values for job queue names, etc).

:::

### GC_JOB_QUEUES

Delete job queues that don't contain any jobs. Safe.

### GC_TASK_IDENTIFIERS

Deletes task identifiers that don't contain any jobs. Unsafe to execute whilst
any Worker is running.

:::warning

It is currently unsafe to run this whilst any Graphile Worker instance is
running since any task identifiers for which there are no jobs queued will be
deleted; when another job with that identifier is queued a _new_ unique
identifier will be generated and that won't match the internal identifiers that
the running workers have cached.

:::

### DELETE_PERMAFAILED_JOBS

Deletes any unlocked jobs that will never be reattempted due to `attempts`
reaching `max_attempts`. Will delete this data, but is otherwise safe.

:::tip

You should write your tasks such that no job will ever permafail; for example
after 20 attempts you might have the job do some cleanup and then exit
successfuly.

:::

### Example

In the CLI:

```bash title="CLI"
graphile-worker --cleanup DELETE_PERMAFAILED_JOBS,GC_TASK_IDENTIFIERS,GC_JOB_QUEUES
```

Or in the library using [WorkerUtils](/docs/library/queue#workerutils):

```ts title="JS API"
await workerUtils.cleanup([
  "DELETE_PERMAFAILED_JOBS",
  "GC_TASK_IDENTIFIERS",
  "GC_JOB_QUEUES",
]);
```
