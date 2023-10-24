---
title: "Introduction"
sidebar_position: 10
---

Graphile Worker is a job queue which uses PostgreSQL to store jobs, and executes
them on Node.js. A job queue allows you to run jobs (e.g. sending emails,
performing calculations, generating PDFs, etc) "in the background" so that your
HTTP response/application code is not held up waiting for them to complete.

## Keep it simple

The main reason behind Graphile Worker (and not a dedicated job queue) is to
help you to keep your infrastructure simple; when you're working with a small
number of engineers on a project, the more infrastructure you have, the more
time you lose to maintenance of that infrastructure, so consolidating your
infrastructure can make a lot of sense. Graphile Worker focusses on performance
to ensure that you can use it as a job queue until your engineering team has
grown enough that you can afford the time to maintain a dedicated job queue.

## Reliable

As you would expect from a job queue, Graphile Worker ensures that your jobs
will not get lost (thanks to Postgres' transactional guarantees), and that each
job will execute at least once. Most jobs will execute exactly once; but if
something goes wrong (either with the job itself, with worker, or with your
infrastructure) then Graphile Worker will automatically retry the job at a later
time, following exponential backoff.

## Postgres-centric

Though Graphile Worker can be executed as a regular Node.js module, its
Postgres-centric ethos means that it is exceptionally well suited to projects
where jobs need to be created from inside the database (e.g. via triggers, or
stored procedures); i.e. it pairs beautifully with
[PostGraphile](https://www.graphile.org/postgraphile/),
[PostgREST](http://postgrest.org/), and any other database-centric application
framework.

## Community-funded

Like all of Graphile's open source software, Graphile Worker is community
funded: we rely on sponsorship and donations to keep maintaining the project. If
you find the project useful and want to help it keep improving, please consider
[sponsoring @Benjie](https://github.com/sponsors/benjie).

## Features

- Standalone and embedded modes
- Designed to be used both from JavaScript or directly in the database
- Easy to test (recommended: `runTaskListOnce` util)
- Low latency (typically under 3ms from task schedule to execution, uses
  `LISTEN`/`NOTIFY` to be informed of jobs as they're inserted)
- High performance (uses `SKIP LOCKED` to find jobs to execute, resulting in
  faster fetches)
- Small tasks (uses explicit task names / payloads resulting in minimal
  serialisation/deserialisation overhead)
- Parallel by default
- Adding jobs to same named queue runs them in series
- Automatically re-attempts failed jobs with exponential back-off
- Customisable retry count (default: 25 attempts over ~3 days)
- Crontab-like scheduling feature for recurring tasks (with optional backfill)
- Task de-duplication via unique `job_key`
- Append data to already enqueued jobs with "batch jobs"
- Flexible runtime controls that can be used for complex rate limiting (e.g. via
  [graphile-worker-rate-limiter](https://github.com/politics-rewired/graphile-worker-rate-limiter))
- Open source; liberal MIT license
- Executes tasks written in Node.js (these can call out to any other language or
  networked service)
- Modern JS with 100% async/await API (no callbacks)
- Written natively in TypeScript
- If you're running really lean, you can run Graphile Worker in the same Node
  process as your server to keep costs and devops complexity down.
