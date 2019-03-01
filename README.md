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

`graphile-worker` manages it's own database schema, `graphile-worker`, just point graphile-worker at your database and we handle the rest:

```
graphile-worker -c "postgres://localhost/mydb"
```

## Uninstallation

To delete the worker code and all the tasks from your database, just run this one SQL statement:

```sql
DROP SCHEMA graphile_worker CASCADE;
```
