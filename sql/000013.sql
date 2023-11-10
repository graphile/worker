--! breaking-change
alter type :GRAPHILE_WORKER_SCHEMA.job_spec alter attribute max_attempts type smallint;
alter type :GRAPHILE_WORKER_SCHEMA.job_spec alter attribute priority type smallint;

drop function :GRAPHILE_WORKER_SCHEMA.add_job;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.add_job(identifier text, payload json DEFAULT NULL::json, queue_name text DEFAULT NULL::text, run_at timestamp with time zone DEFAULT NULL::timestamp with time zone, max_attempts smallint DEFAULT NULL::smallint, job_key text DEFAULT NULL::text, priority smallint DEFAULT NULL::smallint, flags text[] DEFAULT NULL::text[], job_key_mode text DEFAULT 'replace'::text) RETURNS :GRAPHILE_WORKER_SCHEMA.jobs
    LANGUAGE plpgsql
    AS $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  if (job_key is null or job_key_mode is null or job_key_mode in ('replace', 'preserve_run_at')) then
    select * into v_job
    from :GRAPHILE_WORKER_SCHEMA.add_jobs(
      ARRAY[(
        identifier,
        payload,
        queue_name,
        run_at,
        max_attempts,
        job_key,
        priority,
        flags
      ):::GRAPHILE_WORKER_SCHEMA.job_spec],
      (job_key_mode = 'preserve_run_at')
    )
    limit 1;
    return v_job;
  elsif job_key_mode = 'unsafe_dedupe' then
    -- Ensure all the tasks exist
    insert into :GRAPHILE_WORKER_SCHEMA.tasks (identifier)
    values (add_job.identifier)
    on conflict do nothing;
    -- Ensure all the queues exist
    if add_job.queue_name is not null then
      insert into :GRAPHILE_WORKER_SCHEMA.job_queues (queue_name)
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
    insert into :GRAPHILE_WORKER_SCHEMA.jobs (
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
        coalesce(add_job.max_attempts, 25),
        add_job.job_key,
        coalesce(add_job.priority, 0),
        (
          select jsonb_object_agg(flag, true)
          from unnest(add_job.flags) as item(flag)
        )
      from :GRAPHILE_WORKER_SCHEMA.tasks
      left join :GRAPHILE_WORKER_SCHEMA.job_queues
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

DROP FUNCTION :GRAPHILE_WORKER_SCHEMA.reschedule_jobs;
CREATE FUNCTION :GRAPHILE_WORKER_SCHEMA.reschedule_jobs(job_ids bigint[], run_at timestamp with time zone DEFAULT NULL::timestamp with time zone, priority smallint DEFAULT NULL::smallint, attempts smallint DEFAULT NULL::smallint, max_attempts smallint DEFAULT NULL::smallint) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA.jobs
    LANGUAGE sql
    AS $$
  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      run_at = coalesce(reschedule_jobs.run_at, jobs.run_at),
      priority = coalesce(reschedule_jobs.priority, jobs.priority),
      attempts = coalesce(reschedule_jobs.attempts, jobs.attempts),
      max_attempts = coalesce(reschedule_jobs.max_attempts, jobs.max_attempts),
      updated_at = now()
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$;
