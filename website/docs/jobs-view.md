---
title: "The 'jobs' view"
sidebar_position: 105
---

The private tables that jobs are actually stored into are unstable: we may
change them in a patch release, so you should not use them. As of Graphile
Worker 0.16, the `graphile_worker.jobs` view exists as a stable interface to let
you see details of enqueued jobs. The `jobs` view may gain additional columns
over time, but any column deletions or type changes will require a semver major
release of Graphile Worker.

## Performance considerations

:::warning

You should not read from the `jobs` view frequently; any reading from Graphile
Worker's tables can cause a performance impact on the running workers, and doing
this too often could cause major performance degradation for you - especially if
you access many rows, or your read does not use an index.

:::

When reading from the `jobs` view, it's recommended that you only select the
columns you truly need, and that you apply efficient filters to ensure that
Postgres looks at the fewest number of jobs possible.

:::warning

Do not read from the `jobs` view from within a transaction; this could cause
performance issues!

:::

## Columns

- `id` - the primary key of the job
- `queue_name` - the name of the queue (if any) this job was added to
- `task_identifier` - the identifier of the task this job wants to execute
- `priority` - the "priority" (really the "nice") of the job; a numerically
  lower (including negative) value indicates the job should execute before tasks
  with a numerically higher value
- `run_at` - when the job is scheduled to run
- `attempts` - how many times we've attempted to execute this job
- `max_attempts` - the maximum number of times we'll attempt this job
- `last_error` - if an error occurred the last time this job was executed, what
  the error was
- `created_at` - when the job was inserted into the database
- `updated_at` - when the job was last updated
- `key` - the `job_key` of the job, if any
- `locked_at` - when the job was locked, if locked
- `locked_by` - the WorkerPool id that the job was locked by, if locked
- `revision` - the revision number of the job, bumped each time the record is
  updated
- `flags` - the [forbidden flags](/docs/forbidden-flags) associated with this
  job

:::info

The job `payload` is deliberately not included in the `jobs` view to avoid
people from performing expensive filtering using it. If you need to see the
payload of a job, you should use a [tracking table](/docs/schema#tracking-jobs)
instead. If you need it for debugging then you can read it from the private
tables, just be careful, and don't write scripts to do it for you since it might
change in a patch release.

:::
