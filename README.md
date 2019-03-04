# graphile-worker

Job queue for PostgreSQL.

- Uses `LISTEN`/`NOTIFY` to be informed of jobs as they're inserted
- Uses `SKIP LOCKED` to find jobs to execute, resulting in faster fetches
- Uses explicit task names / payloads reducing serialisation/deserialisation overhead
- Runs jobs in parallel by default
- Supports running jobs in series by adding them to the same queue
- Automatically re-attempts jobs with exponential back-off
- Simple implementation - easy to contribute to
- Executes tasks written in JavaScript, these can call out to any other language or networked service
- Modern JS with async/await

## Requirements

PostgreSQL 9.6+ and Node v8.6+.

If your database doesn't already include the `pgcrypto` and `uuid-ossp` extensions we'll automatically install them into the public schema for you.

## Installation

```
yarn add graphile-worker
```

## Running:

`graphile-worker` manages it's own database schema, `graphile-worker`, just point graphile-worker at your database and we handle the rest:

```
graphile-worker -c "postgres://localhost/mydb"
```

## Creating task executors

There's no point having a job queue if there's nothing to execute the jobs!

A task executor is a simple async JS function which receives as input the job
payload and a collection of helpers. It does the work and then returns. If it
returns then the job is deemed a success and is deleted from the queue. If it
throws an error then the job is deemed a failure and the task is rescheduled
using an exponential backoff algorithm.

Tasks are created in the `tasks` folder in the directory from which you run `graphile-worker`.

## Uninstallation

To delete the worker code and all the tasks from your database, just run this one SQL statement:

```sql
DROP SCHEMA graphile_worker CASCADE;
```
