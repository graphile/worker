---
title: Database schema
sidebar_position: 63
---

By default, Graphile Worker installs its tables and functions into a database
schema (namespace) called `graphile_worker`, though this is configurable.

## Public API is functions-only

You should interact with Graphile Worker using the documented APIs (such as the
[`graphile_worker.add_job()` function](/docs/sql-add-job) and the
[administrative functions](/docs/admin-functions)). Database tables are not a
public interface!

:::warning

Do not use the various tables (`jobs`, `job_queues`, `known_crontabs`,
`migrations`, `tasks`) directly. There are a few reasons for this:

1. The various tables may change in a minor version, breaking your assumptions
   (see, for example, the v0.13 ➡️ v0.14 big shift)
2. Reading from the jobs table impacts performance of the queue &mdash;
   especially when doing aggregates or similar
3. Reading from the jobs table inside a transaction prevents those jobs being
   worked on (they may be skipped over as if they don't exist) &mdash; this can
   lead to unexpected results, such as out-of-order execution.

:::

:::tip

You may think reading from the `jobs` table in a read replica is safe &mdash;
and certainly it shouldn't have the performance overhead of doing so on the
primary &mdash; but do keep in mind that we may change the schema of the table
in a minor update, so any code relying on the table structure can be brittle. If
you really feel you need this, please file an issue and we can discuss if there
might be a better way to solve the problem.

:::

## Tracking jobs

Since you should not interact with the `jobs` table directly, should you need to
track completed jobs or associate additional data with any jobs, we suggest that
you create a "shadow" table in your own application's schema in which you can
store additional details.

1. Create your own function to add jobs that delegates to
   `graphile_worker.add_job(...)` under the hood
2. In your function, insert details of the job into your own "shadow" table
3. If you want, add a reference from your "shadow" table to the
   `graphile_worker.jobs` table but be sure to add `ON DELETE CASCADE` (to
   delete the row) or `ON DELETE SET NULL` (to nullify the job id column). Note
   that doing this has performance overhead for the queue, so you should be very
   certain that you need it before doing it.
4. Optionally, add the id of this "shadow" record into the job payload (before
   calling `graphile_worker.add_job(...)`); then you can update this "shadow"
   row from your task code. This is particularly useful to keep the end user
   abreast of the progress of their various background jobs, but is also useful
   for tracking completed jobs (which Graphile Worker will delete on success).
