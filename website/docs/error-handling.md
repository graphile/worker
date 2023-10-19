---
title: "Error handling"
sidebar_position: 130
---

# Error handling

You might be wondering "what happens if something goes wrong?" Here are a few
common ways things can go wrong, and how Graphile Worker handles them.

## Task failure

If a job throws an error, the job is failed and scheduled for retries with
exponential back-off. We use async/await so assuming you write your task code
well all errors should be cascaded down automatically.

## Termination signal

If the worker is sent a termination signal (`SIGTERM`, `SIGINT`, etc), it
triggers a graceful shutdown - i.e. it stops accepting new jobs, waits for the
existing jobs to complete, and then exits. If you need to restart your worker,
you should do so using this graceful process. After 5 seconds (during which more
terminal signals are ignored), if another terminal signal is sent it will
trigger a forceful shutdown: all running jobs will be "failed" (i.e. will retry
on another worker after their exponential back-off) and then the worker will
exit.

## Instantaneous exit

If the worker is terminated in a way that cannot be handled (e.g.
`process.exit()`, segfault, `SIGKILL`, someone pulled the power cord, etc) then
the jobs that that worker was executing remain locked for at least 4 hours.
Every 8-10 minutes a worker will sweep for jobs that have been locked for more
than 4 hours and will make them available to be processed again automatically.
If you run many workers, each worker will do this, so it's likely that jobs will
be released closer to the 4 hour mark. You can unlock jobs earlier than this by
clearing the `locked_at` and `locked_by` columns on the relevant tables.

If the worker schema has not yet been installed into your database, the
following error may appear in your PostgreSQL server logs. This is completely
harmless and should only appear once as the worker will create the schema for
you.

```
ERROR: relation "graphile_worker.migrations" does not exist at character 16
STATEMENT: select id from "graphile_worker".migrations order by id desc limit 1;
```

## Error codes

- `GWBKM` - Invalid `job_key_mode` value, expected `'replace'`,
  `'preserve_run_at'` or `'unsafe_dedupe'`.
