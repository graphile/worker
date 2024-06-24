---
title: Database schema
sidebar_position: 63
---

By default, Graphile Worker installs its tables and functions into a database
schema (namespace) called `graphile_worker`, though this is configurable.

## Only use public APIs

You should interact with Graphile Worker using the APIs documented in this
website (such as the [`graphile_worker.add_job()` function](/docs/sql-add-job)
the [administrative functions](/docs/admin-functions), and
[the `jobs` view](/docs/jobs-view)). Database tables are not a public interface!

:::warning

Do not use the various tables (`_private_jobs`, `_private_job_queues`,
`_private_known_crontabs`, `_private_tasks`, `migrations`) directly. There are a
few reasons for this:

1. The various tables may change in a minor version, breaking your assumptions
   (see, for example, the v0.13 ➡️ v0.14 or v0.15 ➡️ v0.16 big shifts)
2. Reading from the jobs table (or the jobs view) impacts performance of the
   queue &mdash; especially when scanning over all records
3. Reading from the jobs table inside a transaction prevents those jobs being
   worked on (they may be skipped over as if they don't exist) &mdash; this can
   lead to unexpected results, such as out-of-order execution.

:::

:::tip

It should be safe to read from [the `jobs` view](/docs/jobs-view) in a read
replica, but be aware that certain data such as locking information may be out
of date or incorrect therein.

:::

## Tracking jobs

Should you need to track completed jobs or associate additional data with any
jobs, we suggest that you create a "shadow" table in your own application's
schema in which you can store additional details.

1. Create your own function to add jobs that delegates to
   `graphile_worker.add_job(...)` under the hood
2. In your function, insert details of the job into your own "shadow" table
3. If you want, add a reference from your "shadow" table to the
   `graphile_worker._private_jobs` table but be sure to add `ON DELETE CASCADE`
   (to delete the row) or `ON DELETE SET NULL` (to nullify the job id column).
   Note that doing this has performance overhead for the queue, so you should be
   very certain that you need it before doing it. Also this is a private table
   so its schema is likely to change, but you're only referencing the primary
   key here so it should be fine.
4. Optionally, add the id of this "shadow" record into the job payload (before
   calling `graphile_worker.add_job(...)`); then you can update this "shadow"
   row from your task code. This is particularly useful to keep the end user
   abreast of the progress of their various background jobs, but is also useful
   for tracking completed jobs (which Graphile Worker will delete on success).

## Use a PostgreSQL user with restricted rights

Graphile Worker expects to execute as the database owner (not superuser) role.
If you want to use a PostgreSQL user with limited permissions instead, you will
need to make some adjustments.

For example, if you want to create the `graphile_worker` schema yourself then
you can follow the technique described in
[issue #132](https://github.com/graphile/worker/issues/132) to avoid errors
about the worker role missing the privileges required to create the
`graphile_worker` schema. Worker determines whether to create the schema or not
based on whether or not the migrations table in the schema exists, so by
creating the migrations table in addition to the `graphile_worker` schema Worker
should be able to move on to the next step without raising an error.

```sql
create schema graphile_worker;
create table graphile_worker.migrations (
  id int primary key,
  ts timestamptz default now() not null,
  breaking bool default false not null
);
```
