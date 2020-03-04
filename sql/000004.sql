drop function :GRAPHILE_WORKER_SCHEMA.add_job(text, json, text, timestamptz, int, text);

create function :GRAPHILE_WORKER_SCHEMA.add_job(
  identifier text,
  payload json = null,
  queue_name text = null,
  run_at timestamptz = null,
  max_attempts int = null,
  job_key text = null,
  priority int = null
) returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  -- Apply rationality checks
  if length(identifier) > 128 then
    raise exception 'Task identifier is too long (max length: 128).' using errcode = 'GWBID';
  end if;
  if queue_name is not null and length(queue_name) > 128 then
    raise exception 'Job queue name is too long (max length: 128).' using errcode = 'GWBQN';
  end if;
  if job_key is not null and length(job_key) > 512 then
    raise exception 'Job key is too long (max length: 512).' using errcode = 'GWBJK';
  end if;
  if max_attempts < 1 then
    raise exception 'Job maximum attempts must be at least 1' using errcode = 'GWBMA';
  end if;

  if job_key is not null then
    -- Upsert job
    insert into :GRAPHILE_WORKER_SCHEMA.jobs (
      task_identifier,
      payload,
      queue_name,
      run_at,
      max_attempts,
      key,
      priority
    )
      values(
        identifier,
        coalesce(payload, '{}'::json),
        queue_name,
        coalesce(run_at, now()),
        coalesce(max_attempts, 25),
        job_key,
        coalesce(priority, 0)
      )
      on conflict (key) do update set
        task_identifier=excluded.task_identifier,
        payload=excluded.payload,
        queue_name=excluded.queue_name,
        max_attempts=excluded.max_attempts,
        run_at=excluded.run_at,
        priority=excluded.priority,

        -- always reset error/retry state
        attempts=0,
        last_error=null
      where jobs.locked_at is null
      returning *
      into v_job;

    -- If upsert succeeded (insert or update), return early
    if not (v_job is null) then
      return v_job;
    end if;

    -- Upsert failed -> there must be an existing job that is locked. Remove
    -- existing key to allow a new one to be inserted, and prevent any
    -- subsequent retries by bumping attempts to the max allowed.
    update :GRAPHILE_WORKER_SCHEMA.jobs
      set
        key = null,
        attempts = jobs.max_attempts
      where key = job_key;
  end if;

  -- insert the new job. Assume no conflicts due to the update above
  insert into :GRAPHILE_WORKER_SCHEMA.jobs(
    task_identifier,
    payload,
    queue_name,
    run_at,
    max_attempts,
    key,
    priority
  )
    values(
      identifier,
      coalesce(payload, '{}'::json),
      queue_name,
      coalesce(run_at, now()),
      coalesce(max_attempts, 25),
      job_key,
      coalesce(priority, 0)
    )
    returning *
    into v_job;

  return v_job;
end;
$$ language plpgsql volatile;

create function :GRAPHILE_WORKER_SCHEMA.complete_jobs(
  job_ids bigint[]
) returns setof :GRAPHILE_WORKER_SCHEMA.jobs as $$
  delete from :GRAPHILE_WORKER_SCHEMA.jobs
    where id = any(job_ids)
    and (
      locked_by is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$ language sql volatile;

create function :GRAPHILE_WORKER_SCHEMA.permanently_fail_jobs(
  job_ids bigint[],
  error_message text = null
) returns setof :GRAPHILE_WORKER_SCHEMA.jobs as $$
  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      last_error = coalesce(error_message, 'Manually marked as failed'),
      attempts = max_attempts
    where id = any(job_ids)
    and (
      locked_by is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$ language sql volatile;

create function :GRAPHILE_WORKER_SCHEMA.reschedule_jobs(
  job_ids bigint[],
  run_at timestamptz = null,
  priority int = null,
  attempts int = null,
  max_attempts int = null
) returns setof :GRAPHILE_WORKER_SCHEMA.jobs as $$
  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      run_at = coalesce(reschedule_jobs.run_at, jobs.run_at),
      priority = coalesce(reschedule_jobs.priority, jobs.priority),
      attempts = coalesce(reschedule_jobs.attempts, jobs.attempts),
      max_attempts = coalesce(reschedule_jobs.max_attempts, jobs.max_attempts)
    where id = any(job_ids)
    and (
      locked_by is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$ language sql volatile;
