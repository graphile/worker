---
title: Requirements
sidebar_position: 30
---

The current version of Graphile Worker requires PostgreSQL 12+ and Node 18+[^1].

Once a version of PostgreSQL or Node.js reaches end of life, we also no longer
support it and may drop support in a minor update. Should you require support
for an end-of-life version of one of these projects, please get in touch about
our commercial support options.

[^1]: Might work with older versions, but has not been tested.

:::note

`graphile-worker` versions before 0.13.0 installed the `pgcrypto` extension into
the public schema of your database (if it wasn't already installed). As of
version 0.13.0 we no longer use `pgcrypto`. Existing users may want to uninstall
it - see the
[release notes](https://github.com/graphile/worker/blob/main/RELEASE_NOTES.md#v0130)
for instructions.

:::

:::note

Postgres 12 is required for the `generated always as (expression)` feature; if
you need to use earlier versions of Postgres or Node, please use version 0.13.x
or earlier.

:::

## Rationality checks

We recommend that you limit `queue_name`, `task_identifier` and `job_key` to
printable ASCII characters.

- `queue_name` can be at most 128 characters long
- `task_identifier` can be at most 128 characters long
- `job_key` can be at most 512 characters long
- `schema` should be reasonable; max 32 characters is preferred. Defaults to
  `graphile_worker` (15 chars)
