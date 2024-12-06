---
title: "CLI: Running jobs"
sidebar_label: "Running jobs"
sidebar_position: 50
---

To run Graphile Worker, simply run the `graphile-worker` binary passing your
PostgreSQL [connection string](#connection-string) via the `-c` entry. Worker
manages its own database schema (`graphile_worker`) into which jobs are stored;
when you start Graphile Worker it will automatically create or update this
schema if necessary.

```sh
npx graphile-worker -c "postgres:///my_db"
```

:::tip

`npx` looks for the `graphile-worker` binary locally; it&apos;s often better to
use the `"scripts"` entry in `package.json` instead.

:::

:::info

Graphile Worker expects the Postgres role used at runtime to be the same as the
role used while running the migrations. If you need to run your migrations as a
different role, one solution is to explicitly change the owner of the
`graphile_worker.*` tables to be the same role as is used at runtime.

:::

## CLI options

The following CLI options are available (`graphile-worker --help`):

```
Options:
      --help                    Show help                              [boolean]
      --version                 Show version number                    [boolean]
  -c, --connection              Database connection string, defaults to the
                                'DATABASE_URL' envvar                   [string]
  -s, --schema                  The database schema in which Graphile Worker is
                                (to be) located                         [string]
      --schema-only             Just install (or update) the database schema,
                                then exit             [boolean] [default: false]
      --once                    Run until there are no runnable jobs left, then
                                exit                  [boolean] [default: false]
      --crontab                 override path to crontab file           [string]
  -j, --jobs                    number of jobs to run concurrently      [number]
  -m, --max-pool-size           maximum size of the PostgreSQL pool     [number]
      --poll-interval           how long to wait between polling for jobs in
                                milliseconds (for jobs scheduled in the
                                future/retries)                         [number]
      --no-prepared-statements  set this flag if you want to disable prepared
                                statements, e.g. for compatibility with some
                                external PostgreSQL pools              [boolean]
  -C, --config                  The path to the config file             [string]
      --cleanup                 Clean the database, then exit. Accepts a
                                comma-separated list of cleanup tasks:
                                GC_TASK_IDENTIFIERS, GC_JOB_QUEUES,
                                DELETE_PERMAFAILED_JOBS                 [string]

```

## Connection string

A PostgreSQL connection string looks like this:

```
postgres://[user]:[pass]@[host]:[port]/[databaseName]?[parameter]=[value]
```

Where each of the `[...]` placeholders are optional. Here are some examples:

- `postgres:///my_db` &mdash; connect to database `my_db` on the default host
  (localhost) and default port (5432)
- `postgres://127.0.0.1/my_db`
- `postgres://127.0.0.1:5432/my_db`
- `postgres://postgres:postgres@127.0.0.1:5432/my_db`
- `postgres://postgres:postgres@127.0.0.1:5432/my_db?ssl=1`
