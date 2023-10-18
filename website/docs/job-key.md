---
title: "Job key"
sidebar_position: 80
---

When a job is added, you may opt to give it a "job key". Doing so will allow you
to identify this job in future such that you can replace, update or remove it.

:::danger

Be sure to read the [`job_key` caveats](#job_key-caveats) below!

:::

## Replacing/updating jobs

Jobs scheduled with a `job_key` parameter may be replaced/updated by calling
`add_job` again with the same `job_key` value. This can be used for rescheduling
jobs, to ensure only one of a given job is scheduled at a time, or to update
other settings for the job.

For example after the below SQL transaction, the `send_email` job will run only
once, with the payload `'{"count": 2}'`:

```sql
BEGIN;
SELECT graphile_worker.add_job('send_email', '{"count": 1}', job_key := 'abc');
SELECT graphile_worker.add_job('send_email', '{"count": 2}', job_key := 'abc');
COMMIT;
```

In all cases if no match is found then a new job will be created.

### `job_key_mode`

Behavior when an existing job with the same job key is found is controlled by
the `job_key_mode` setting:

- `replace` (default) - overwrites the unlocked job with the new values. This is
  primarily useful for rescheduling, updating, or **debouncing** (delaying
  execution until there have been no events for at least a certain time period).
  Locked jobs will cause a new job to be scheduled instead.
- `preserve_run_at` - overwrites the unlocked job with the new values, but
  preserves `run_at`. This is primarily useful for **throttling** (executing at
  most once over a given time period). Locked jobs will cause a new job to be
  scheduled instead.
- `unsafe_dedupe` - if an existing job is found, even if it is locked or
  permanently failed, then it won't be updated. This is very dangerous as it
  means that the event that triggered this `add_job` call may not result in any
  action. It is strongly advised you do not use this mode unless you are certain
  you know what you are doing.

The full `job_key_mode` algorithm is roughly as follows:

- If no existing job with the same job key is found:
  - a new job will be created with the new attributes.
- Otherwise, if `job_key_mode` is `unsafe_dedupe`:
  - stop and return the existing job.
- Otherwise, if the existing job is locked:
  - it will have its `key` cleared
  - it will have its attempts set to `max_attempts` to avoid it running again
  - a new job will be created with the new attributes.
- Otherwise, if the existing job has previously failed:
  - it will have its `attempts` reset to 0 (as if it were newly scheduled)
  - it will have its `last_error` cleared
  - it will have all other attributes updated to their new values, including
    `run_at` (even when `job_key_mode` is `preserve_run_at`).
- Otherwise, if `job_key_mode` is `preserve_run_at`:
  - the job will have all its attributes except for `run_at` updated to their
    new values.
- Otherwise:
  - the job will have all its attributes updated to their new values.

## Removing jobs

Pending jobs may also be removed using `job_key`:

```sql
SELECT graphile_worker.remove_job('abc');
```

## `job_key` caveats

Jobs that complete successfully are deleted, there is no permanent `job_key`
log, i.e. `remove_job` on a completed `job_key` is a no-op as no row exists.

The `job_key` is treated as universally unique (whilst the job is
pending/failed), so you can update a job to have a completely different
`task_identifier` or `payload`. You must be careful to ensure that your
`job_key` is sufficiently unique to prevent you accidentally replacing or
deleting unrelated jobs by mistake; one way to approach this is to incorporate
the `task_identifier` into the `job_key`.

If a job is updated using `add_job` when it is currently locked (i.e. running),
a second job will be scheduled separately (unless
`job_key_mode = 'unsafe_dedupe'`), meaning both will run. (The old job will be
prevented from running again, and will have the `job_key` removed from it.)

Calling `remove_job` for a locked (i.e. running) job will not actually remove
it, but will prevent it from running again on failure.
