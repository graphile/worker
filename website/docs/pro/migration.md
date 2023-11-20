---
title: "Live migration"
sidebar_position: 10
---

Normally we recommend you shut down all of your Graphile Worker instances before
upgrading to certain new versions of Worker, since schema and API changes may
cause older workers to break, leading to long waits and/or duplicate execution
due to failure to mark jobs complete. To know which versions of Worker are
impacted, please see the [Release Notes](/releases).

Worker Pro performs checks on startup and tracks running workers so that each
Worker can know if they&apos;re out of date (in which case they should
gracefully shut down) or if they need to wait for previous worker versions to
exit fully before they can run migrations. Worker Pro understands which
migrations are safe versus breaking, and can help you to roll out new versions
of Worker on a server-by-server basis without having to scale your workers to
zero before applying an update.

## Configuration

See [Pro configuration](./config.md) for details on how to configure Worker Pro,
including the full meaning of each option.

The live migration feature relies on the following settings:

- `heartbeatInterval` &mdash; worker checkin frequency
- `maxMigrationWaitTime` &mdash; how long to wait for old active workers to
  complete current jobs before force migrating

## Caveats

You must be running the latest supported version of Worker Pro across your
entire Worker fleet before you rely on this functionality.

Once you adopt Worker Pro and are certain that all running workers are using
Worker Pro you must do a one-time cleanup of your database: specifically, you
need to unlock all jobs that were locked by older workers (workers not running
Worker Pro). This must be done before you migrate otherwise you risk receiving
division by zero migration errors (these errors are convenient for assertions in
the migrations).

For Graphile Worker before (excluding) v0.16.0 this will look something like:

```sql
begin;
update graphile_worker.jobs
set locked_at = null, locked_by = null
where locked_by is not null and locked_by not in (
  select worker_id from graphile_worker._private_pro_workers
);
update graphile_worker.job_queues
set locked_at = null, locked_by = null
where locked_by is not null and locked_by not in (
  select worker_id from graphile_worker._private_pro_workers
);
commit;
```

For Graphile Worker v0.16.0+ it would be:

```sql
begin;
update graphile_worker._private_jobs as jobs
set locked_at = null, locked_by = null
where locked_by is not null and locked_by not in (
  select worker_id from graphile_worker._private_pro_workers
);
update graphile_worker._private_job_queues as job_queues
set locked_at = null, locked_by = null
where locked_by is not null and locked_by not in (
  select worker_id from graphile_worker._private_pro_workers
);
commit;
```
