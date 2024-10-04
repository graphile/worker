---
title: "Adding jobs through SQL"
sidebar_position: 70
---

You can schedule jobs directly in the database, e.g. from a trigger or function,
or by calling SQL from your application code. You do this using the
`graphile_worker.add_job` function (or the experimental
`graphile_worker.add_jobs` function for bulk inserts, see
[below](#graphile_workeradd_jobs)).

## `graphile_worker.add_job()`

NOTE: the [`addJob`](./library/add-job.md) JavaScript method simply defers to
this underlying `add_job` SQL function.

`add_job` accepts the following parameters (in this order):

- `identifier` &mdash; the only **required** field, indicates the name of the
  task executor to run (omit the `.js` suffix!)
- `payload` &mdash; a JSON object with information to tell the task executor
  what to do, or an array of one or more of these objects for &ldquo;batch
  jobs&rdquo; (defaults to an empty object).
- `queue_name` &mdash; if you want certain tasks to run one at a time, add them
  to the same named queue (defaults to `null`).
- `run_at` &mdash; a timestamp after which to run the job; defaults to now.
- `max_attempts` &mdash; if this task fails, how many times should we retry it?
  (defaults to `25`. Must be castable to `smallint`).
- `job_key` &mdash; unique identifier for the job, used to replace, update or
  remove it later if needed (see
  [Replacing and updating jobs](./job-key.md#replacingupdating-jobs) and
  [removing jobs](./job-key.md#removing-jobs)); can also be used for
  de-duplication.
- `priority` &mdash; an integer representing the jobs priority. Jobs are
  executed in numerically ascending order of priority (jobs with a numerically
  smaller priority are run first). Defaults to `0`. Must be castable to
  `smallint`.
- `flags` &mdash; an optional text array (`text[]`) representing a flags to
  attach to the job. Can be used alongside the `forbiddenFlags` option in
  library mode to implement complex rate limiting or other behaviors which
  requiring skipping jobs at runtime (see
  [Forbidden flags](./forbidden-flags.md)).
- `job_key_mode` &mdash; when `job_key` is specified, this setting indicates
  what should happen when an existing job is found with the same job key:
  - `replace` (default) &mdash; all job parameters are updated to the new
    values, including the `run_at` (inserts new job if matching job is locked).
  - `preserve_run_at` &mdash; all job parameters are updated to the new values,
    except for `run_at` which maintains the previous value (inserts new job if
    matching job is locked).
  - `unsafe_dedupe` &mdash; only inserts the job if no existing job (whether or
    not it is locked or has failed permanently) with matching key is found; does
    not update the existing job.

Typically you&apos;ll want to set the `identifier` and `payload`:

```sql
SELECT graphile_worker.add_job(
  'send_email',
  json_build_object(
    'to', 'someone@example.com',
    'subject', 'graphile-worker test'
  )
);
```

It&apos;s recommended that you use
[PostgreSQL&apos;s named parameters](https://www.postgresql.org/docs/current/sql-syntax-calling-funcs.html#SQL-SYNTAX-CALLING-FUNCS-NAMED)
for the other parameters so that you only need specify the arguments you're
using:

```sql
SELECT graphile_worker.add_job('reminder', run_at := NOW() + INTERVAL '2 days');
```

:::tip

If you want to run a job after a variable number of seconds according to the
database time (rather than the application time), you can use interval
multiplication; see `run_at` in this example:

```sql
SELECT graphile_worker.add_job(
  $1,
  payload := $2,
  queue_name := $3,
  run_at := NOW() + ($4 * INTERVAL '1 second'),
  max_attempts := $5
);
```

:::

:::note

`graphile_worker.add_job(...)` requires database owner privileges to execute. To
allow lower-privileged users to call it, wrap it inside a PostgreSQL function
marked as `SECURITY DEFINER` so that it will run with the same privileges as the
more powerful user that defined it. (Be sure that this function performs any
access checks that are necessary.)

:::

### Example: simple trigger

This snippet creates a trigger function which adds a job to execute
`task_identifier_here` when a new row is inserted into `my_table`.

```sql
CREATE FUNCTION my_table_created() RETURNS trigger AS $$
BEGIN
  PERFORM graphile_worker.add_job('task_identifier_here', json_build_object('id', NEW.id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE TRIGGER trigger_name AFTER INSERT ON my_table FOR EACH ROW EXECUTE PROCEDURE my_table_created();
```

### Example: one trigger function to rule them all

If your tables are all defined with a single primary key named `id` then you can
define a more convenient dynamic trigger function which can be called from
multiple triggers for multiple tables to quickly schedule jobs.

```sql
CREATE FUNCTION trigger_job() RETURNS trigger AS $$
BEGIN
  PERFORM graphile_worker.add_job(TG_ARGV[0], json_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table', TG_TABLE_NAME,
    'op', TG_OP,
    'id', (CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END)
  ));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql VOLATILE;
```

You might use this trigger like this:

```sql
CREATE TRIGGER send_verification_email
  AFTER INSERT ON user_emails
  FOR EACH ROW
  WHEN (NEW.verified is false)
  EXECUTE PROCEDURE trigger_job('send_verification_email');
CREATE TRIGGER user_changed
  AFTER INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_job('user_changed');
CREATE TRIGGER generate_pdf
  AFTER INSERT ON pdfs
  FOR EACH ROW
  EXECUTE PROCEDURE trigger_job('generate_pdf');
CREATE TRIGGER generate_pdf_update
  AFTER UPDATE ON pdfs
  FOR EACH ROW
  WHEN (NEW.title IS DISTINCT FROM OLD.title)
  EXECUTE PROCEDURE trigger_job('generate_pdf');
```

## `graphile_worker.add_jobs()`

:::caution Experimental

This API may change in a semver minor release.

:::

For bulk insertion of jobs, we&apos;ve introduced the `graphile_worker.add_jobs`
function. It accepts the following options:

- `specs` - an array of `graphile_worker.job_spec` objects
- `job_key_preserve_run_at` - an optional boolean detailing if the `run_at`
  should be preserved when the same `job_key` is seen again

The `job_spec` object has the following properties, all of which correspond with
the `add_job` option of the same name above.

- `identifier`
- `payload`
- `queue_name`
- `run_at`
- `max_attempts`
- `job_key`
- `priority`
- `flags`

:::note

`job_key_mode='unsafe_dedupe'` is not supported in `add_jobs` &mdash; you must
add jobs one at a time using `add_job` to use that. The equivalent of
`job_key_mode='replace'` is enabled by default, to change this to the same
behavior as `job_key_mode='preserve_run_at'` you should set
`job_key_preserve_run_at` to `true`.

:::
