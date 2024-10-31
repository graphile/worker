---
title: "Recurring tasks (crontab)"
sidebar_position: 90
---

You can schedule a job to run in the future using the `run_at` property; however
if you want to have jobs automatically created on a schedule then this is for
you.

## Recurring schedule

Graphile Worker supports triggering recurring tasks according to a cron-like
schedule. This is designed for recurring tasks such as sending a weekly email,
running database maintenance tasks every day, performing data roll-ups hourly,
downloading external data every 20 minutes, etc.

Graphile Worker&apos;s crontab support:

- guarantees (thanks to ACID-compliant transactions) that no duplicate task
  schedules will occur
- can backfill missed jobs if desired (e.g. if the Worker wasn&apos;t running
  when the job was due to be scheduled)
- schedules tasks using Graphile Worker&apos;s regular job queue, so you get all
  the regular features such as exponential back-off on failure.
- works reliably even if you&apos;re running multiple workers (see
  &ldquo;Distributed crontab&rdquo; below)

:::note

It is not intended that you add recurring tasks for each of your individual
application users, instead you should have relatively few recurring tasks, and
those tasks can create additional jobs for the individual users (or process
multiple users) if necessary.

:::

Tasks are by default read from a `crontab` file next to the `tasks/` folder (but
this is configurable in library mode). Please note that our syntax is not 100%
compatible with cron&apos;s, and our task payload differs. We only handle
timestamps in UTC.

## `crontab` format

The following diagram details the parts of a Graphile Worker crontab schedule:

```crontab
# ┌───────────── UTC minute (0 - 59)
# │ ┌───────────── UTC hour (0 - 23)
# │ │ ┌───────────── UTC day of the month (1 - 31)
# │ │ │ ┌───────────── UTC month (1 - 12)
# │ │ │ │ ┌───────────── UTC day of the week (0 - 6) (Sunday to Saturday)
# │ │ │ │ │ ┌───────────── task (identifier) to schedule
# │ │ │ │ │ │    ┌────────── optional scheduling options
# │ │ │ │ │ │    │     ┌────── optional payload to merge
# │ │ │ │ │ │    │     │
# │ │ │ │ │ │    │     │
# * * * * * task ?opts {payload}
```

Comment lines start with a `#`.

For the first 5 fields we support an explicit numeric value, `*` to represent
all valid values, `*/n` (where `n` is a positive integer) to represent all valid
values divisible by `n`, range syntax such as `1-5`, and any combination of
these separated by commas.

The task identifier should match the following regexp
`/^[_a-zA-Z][_a-zA-Z0-9:_-]*$/` (namely it should start with an alphabetic
character and it should only contain alphanumeric characters, colon, underscore
and hyphen). It should be the name of one of your Graphile Worker tasks.

### Crontab `opts`

The `opts` must always be prefixed with a `?` if provided and details
configuration for the task such as what should be done in the event that the
previous event was not scheduled (e.g. because the Worker wasn&apos;t running).
Options are specified using HTTP query string syntax (with `&` separator).

Currently we support the following `opts`:

- `id=UID` where UID is a unique alphanumeric case-sensitive identifier starting
  with a letter &mdash; specify an identifier for this crontab entry; by default
  this will use the task identifier, but if you want more than one schedule for
  the same task (e.g. with different payload, or different times) then you will
  need to supply a unique identifier explicitly.
- `fill=t` where `t` is a &ldquo;time phrase&rdquo; (see below) &mdash; backfill
  any entries from the last time period `t`, for example if the worker was not
  running when they were due to be executed (by default, no backfilling).
- `max=n` where `n` is a small positive integer &mdash; override the
  `max_attempts` of the job.
- `queue=name` where `name` is an alphanumeric queue name &mdash; add the job to
  a named queue so it executes serially.
- `jobKey=key` where `key` is any valid job key &mdash; replace/update the
  existing job with this key, if present.
- `jobKeyMode=replace|preserve_run_at` &mdash; if `jobKey` is specified, affects
  what it does.
- `priority=n` where `n` is a relatively small integer &mdash; override the
  priority of the job.

:::warning

Changing the identifier (e.g. via `id`) can result in duplicate executions, so
we recommend that you explicitly set it and never change it.

:::

:::note

Using `fill` will not backfill new tasks, only tasks that were previously known.

:::

:::caution

The higher you set the `fill` parameter, the longer the worker startup time will
be; when used you should set it to be slightly larger than the longest period of
downtime you expect for your worker.

:::

#### Time phrase

Time phrases are comprised of a sequence of number-letter combinations, where
the number represents a quantity and the letter represents a time period, e.g.
`5d` for `five days`, or `3h` for `three hours`; e.g. `4w3d2h1m` represents
`4 weeks, 3 days, 2 hours and 1 minute` (i.e. a period of 44761 minutes). The
following time periods are supported:

- `s` - one second (1000 milliseconds)
- `m` - one minute (60 seconds)
- `h` - one hour (60 minutes)
- `d` - one day (24 hours)
- `w` - one week (7 days)

### `payload`

The `payload` is a JSON5 object; it must start with a `{`, must not contain
newlines or carriage returns (`\n` or `\r`), and must not contain trailing
whitespace. It will be merged into the default crontab payload properties.

Each crontab job will have a JSON object payload containing the key `_cron` with
the value being an object with the following entries:

- `ts` - ISO8601 timestamp representing when this job was due to execute
- `backfilled` - true if the task was "backfilled" (i.e. it wasn't scheduled on
  time), false otherwise

## Distributed crontab

**TL;DR**: when running identical crontabs on multiple workers no special action
is necessary &mdash; it Just Works :tm:

When you run multiple workers with the same crontab files then the first worker
that attempts to queue a particular cron job will succeed and the other workers
will take no action &mdash; this is thanks to SQL ACID-compliant transactions
and our `known_crontabs` lock table.

If your workers have different crontabs then you must be careful to ensure that
the cron items each have unique identifiers; the easiest way to do this is to
specify the identifiers yourself (see the `id=` option above). Should you forget
to do this then for any overlapping timestamps for items that have the same
derived identifier one of the cron tasks will schedule but the others will not.

## Examples

The following schedules the `send_weekly_email` task at 4:30am (UTC) every
Monday:

```
30 4 * * 1 send_weekly_email
```

The following does similar, but also will backfill any tasks over the last two
days (`2d`), sets max attempts to `10` and merges in `{"onboarding": false}`
into the task payload:

```
30 4 * * 1 send_weekly_email ?fill=2d&max=10 {onboarding:false}
```

The following triggers the `rollup` task every 4 hours on the hour:

```
0 */4 * * * rollup
```

## Limiting backfill

When you ask Graphile Worker to backfill jobs, it will do so for all jobs
matching that specification that should have been scheduled over the backfill
period. Other than the period itself, you cannot place limits on the backfilling
(for example, you cannot say &ldquo;backfill at most one job&rdquo; or
&ldquo;only backfill if the next job isn&apos;t due within the next 3
hours&rdquo;); this is because we&apos;ve determined that there&apos;s many
situations (back-off, overloaded worker, serially executed jobs, etc.) in which
the result of this behaviour might result in outcomes that the user did not
expect.

If you need these kinds of constraints on backfilled jobs, you should implement
them _at runtime_ (rather than at scheduling time) in the task executor itself,
which could use the `payload._cron.ts` property to determine whether execution
should continue or not.

## Specifying cron items in library mode

You&apos;ve three options for specifying cron tasks in library mode:

1. `crontab`: a crontab string (like the contents of a crontab file)
2. `crontabFile`: the (string) path to a crontab file, from which to read the
   rules
3. `parsedCronItems`: explicit parsed cron items (see below)

### `parsedCronItems`

The Graphile Worker internal format for cron items lists all the matching
minutes/hours/etc uniquely and in numerically ascending order. It also has other
requirements and is to be treated as an opaque type, so you must not construct
this value manually.

Instead, you may specify the `parsedCronItems` using one of the helper
functions:

1. `parseCrontab`: pass a crontab string and it will be converted into a list of
   `ParsedCronItem`s
2. `parseCronItems`: pass a list of `CronItem`s and it will be converted into a
   list of `ParsedCronItem`s

The `CronItem` type is designed to be written by humans (and their scripts) and
has the following properties:

- `task` (required): the string identifier of the task that should be executed
  (same as the first argument to `add_job`)
- `match` (required): a cron pattern (e.g. `* * * * *`) describing when to run
  this task
- `options`: optional options influencing backfilling, etc
  - `backfillPeriod`: how long (in milliseconds) to backfill (see above)
  - `maxAttempts`: the maximum number of attempts we'll give the job
  - `queueName`: if you want the job to run serially, you can add it to a named
    queue
  - `priority`: optionally override the priority of the job
- `payload`: an optional payload object to merge into the generated payload for
  the job
- `identifier`: an optional string to give this cron item a permanent
  identifier; if not given we will use the `task`. This is particularly useful
  if you want to schedule the same task multiple times, perhaps on different
  time patterns or with different payloads or other options (since every cron
  item must have a unique identifier).
