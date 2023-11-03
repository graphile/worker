--! breaking-change
alter table :GRAPHILE_WORKER_SCHEMA.jobs rename to _private_jobs;
alter table :GRAPHILE_WORKER_SCHEMA.job_queues rename to _private_job_queues;
alter table :GRAPHILE_WORKER_SCHEMA.tasks rename to _private_tasks;
alter table :GRAPHILE_WORKER_SCHEMA.known_crontabs rename to _private_known_crontabs;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.add_job;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.add_job(identifier text, payload json DEFAULT NULL::json, queue_name text DEFAULT NULL::text, run_at timestamp with time zone DEFAULT NULL::timestamp with time zone, max_attempts integer DEFAULT NULL::integer, job_key text DEFAULT NULL::text, priority integer DEFAULT NULL::integer, flags text[] DEFAULT NULL::text[], job_key_mode text DEFAULT 'replace'::text) RETURNS :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE plpgsql
    AS $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA._private_jobs;
begin
  if (job_key is null or job_key_mode is null or job_key_mode in ('replace', 'preserve_run_at')) then
    select * into v_job
    from :GRAPHILE_WORKER_SCHEMA.add_jobs(
      ARRAY[(
        identifier,
        payload,
        queue_name,
        run_at,
        max_attempts::smallint,
        job_key,
        priority::smallint,
        flags
      ):::GRAPHILE_WORKER_SCHEMA.job_spec],
      (job_key_mode = 'preserve_run_at')
    )
    limit 1;
    return v_job;
  elsif job_key_mode = 'unsafe_dedupe' then
    -- Ensure all the tasks exist
    insert into :GRAPHILE_WORKER_SCHEMA._private_tasks as tasks (identifier)
    values (add_job.identifier)
    on conflict do nothing;
    -- Ensure all the queues exist
    if add_job.queue_name is not null then
      insert into :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues (queue_name)
      values (add_job.queue_name)
      on conflict do nothing;
    end if;
    -- Insert job, but if one already exists then do nothing, even if the
    -- existing job has already started (and thus represents an out-of-date
    -- world state). This is dangerous because it means that whatever state
    -- change triggered this add_job may not be acted upon (since it happened
    -- after the existing job started executing, but no further job is being
    -- scheduled), but it is useful in very rare circumstances for
    -- de-duplication. If in doubt, DO NOT USE THIS.
    insert into :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs (
      job_queue_id,
      task_id,
      payload,
      run_at,
      max_attempts,
      key,
      priority,
      flags
    )
      select
        job_queues.id,
        tasks.id,
        coalesce(add_job.payload, '{}'::json),
        coalesce(add_job.run_at, now()),
        coalesce(add_job.max_attempts::smallint, 25::smallint),
        add_job.job_key,
        coalesce(add_job.priority::smallint, 0::smallint),
        (
          select jsonb_object_agg(flag, true)
          from unnest(add_job.flags) as item(flag)
        )
      from :GRAPHILE_WORKER_SCHEMA._private_tasks as tasks
      left join :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues
      on job_queues.queue_name = add_job.queue_name
      where tasks.identifier = add_job.identifier
    on conflict (key)
      -- Bump the updated_at so that there's something to return
      do update set
        revision = jobs.revision + 1,
        updated_at = now()
      returning *
      into v_job;
    return v_job;
  else
    raise exception 'Invalid job_key_mode value, expected ''replace'', ''preserve_run_at'' or ''unsafe_dedupe''.' using errcode = 'GWBKM';
  end if;
end;
$$;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.add_jobs;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.add_jobs(specs :GRAPHILE_WORKER_SCHEMA.job_spec[], job_key_preserve_run_at boolean DEFAULT false) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE plpgsql
    AS $$
begin
  -- Ensure all the tasks exist
  insert into :GRAPHILE_WORKER_SCHEMA._private_tasks as tasks (identifier)
  select distinct spec.identifier
  from unnest(specs) spec
  on conflict do nothing;
  -- Ensure all the queues exist
  insert into :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues (queue_name)
  select distinct spec.queue_name
  from unnest(specs) spec
  where spec.queue_name is not null
  on conflict do nothing;
  -- Ensure any locked jobs have their key cleared - in the case of locked
  -- existing job create a new job instead as it must have already started
  -- executing (i.e. it's world state is out of date, and the fact add_job
  -- has been called again implies there's new information that needs to be
  -- acted upon).
  update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
  set
    key = null,
    attempts = jobs.max_attempts,
    updated_at = now()
  from unnest(specs) spec
  where spec.job_key is not null
  and jobs.key = spec.job_key
  and is_available is not true;
  -- TODO: is there a risk that a conflict could occur depending on the
  -- isolation level?
  return query insert into :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs (
    job_queue_id,
    task_id,
    payload,
    run_at,
    max_attempts,
    key,
    priority,
    flags
  )
    select
      job_queues.id,
      tasks.id,
      coalesce(spec.payload, '{}'::json),
      coalesce(spec.run_at, now()),
      coalesce(spec.max_attempts, 25),
      spec.job_key,
      coalesce(spec.priority, 0),
      (
        select jsonb_object_agg(flag, true)
        from unnest(spec.flags) as item(flag)
      )
    from unnest(specs) spec
    inner join :GRAPHILE_WORKER_SCHEMA._private_tasks as tasks
    on tasks.identifier = spec.identifier
    left join :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues
    on job_queues.queue_name = spec.queue_name
  on conflict (key) do update set
    job_queue_id = excluded.job_queue_id,
    task_id = excluded.task_id,
    payload =
      case
      when json_typeof(jobs.payload) = 'array' and json_typeof(excluded.payload) = 'array' then
        (jobs.payload::jsonb || excluded.payload::jsonb)::json
      else
        excluded.payload
      end,
    max_attempts = excluded.max_attempts,
    run_at = (case
      when job_key_preserve_run_at is true and jobs.attempts = 0 then jobs.run_at
      else excluded.run_at
    end),
    priority = excluded.priority,
    revision = jobs.revision + 1,
    flags = excluded.flags,
    -- always reset error/retry state
    attempts = 0,
    last_error = null,
    updated_at = now()
  where jobs.locked_at is null
  returning *;
end;
$$;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.complete_jobs;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.complete_jobs(job_ids bigint[]) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE sql
    AS $$
  delete from :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < now() - interval '4 hours'
    )
    returning *;
$$;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.force_unlock_workers;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.force_unlock_workers(worker_ids text[]) RETURNS void
    LANGUAGE sql
    AS $$
update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
update :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
$$;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.permanently_fail_jobs;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.permanently_fail_jobs(job_ids bigint[], error_message text DEFAULT NULL::text) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE sql
    AS $$
  update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
    set
      last_error = coalesce(error_message, 'Manually marked as failed'),
      attempts = max_attempts,
      updated_at = now()
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.remove_job;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.remove_job(job_key text) RETURNS :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE plpgsql STRICT
    AS $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA._private_jobs;
begin
  -- Delete job if not locked
  delete from :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
    where key = job_key
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
  returning * into v_job;
  if not (v_job is null) then
    return v_job;
  end if;
  -- Otherwise prevent job from retrying, and clear the key
  update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
  set
    key = null,
    attempts = jobs.max_attempts,
    updated_at = now()
  where key = job_key
  returning * into v_job;
  return v_job;
end;
$$;

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.reschedule_jobs;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.reschedule_jobs(job_ids bigint[], run_at timestamp with time zone DEFAULT NULL::timestamp with time zone, priority integer DEFAULT NULL::integer, attempts integer DEFAULT NULL::integer, max_attempts integer DEFAULT NULL::integer) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE sql
    AS $$
  update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
    set
      run_at = coalesce(reschedule_jobs.run_at, jobs.run_at),
      priority = coalesce(reschedule_jobs.priority::smallint, jobs.priority),
      attempts = coalesce(reschedule_jobs.attempts::smallint, jobs.attempts),
      max_attempts = coalesce(reschedule_jobs.max_attempts::smallint, jobs.max_attempts),
      updated_at = now()
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$;
