CREATE OR REPLACE FUNCTION :GRAPHILE_WORKER_SCHEMA.add_jobs(specs :GRAPHILE_WORKER_SCHEMA.job_spec[], job_key_preserve_run_at boolean DEFAULT false) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE plpgsql
    AS $$
declare
  v_remaining_specs :GRAPHILE_WORKER_SCHEMA.job_spec[] := specs;
begin
  -- Ensure all the tasks exist (insert only missing identifiers so identity is not consumed)
  insert into :GRAPHILE_WORKER_SCHEMA._private_tasks as tasks (identifier)
  select distinct spec.identifier
  from unnest(specs) spec
  where not exists (
    select 1
    from :GRAPHILE_WORKER_SCHEMA._private_tasks as existing
    where existing.identifier = spec.identifier
  )
  on conflict do nothing;
  -- Ensure all the queues exist
  insert into :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues (queue_name)
  select distinct spec.queue_name
  from unnest(specs) spec
  where spec.queue_name is not null
  and not exists (
    select 1
    from :GRAPHILE_WORKER_SCHEMA._private_job_queues as existing
    where existing.queue_name = spec.queue_name
  )
  on conflict do nothing;

  -- WARNING: this count is not 100% accurate; 'on conflict' clause will cause it to be an overestimate
  perform pg_notify('jobs:insert', '{"r":' || random()::text || ',"count":' || coalesce(array_length(specs, 1), 0)::text || '}');

  loop
    exit when coalesce(array_length(v_remaining_specs, 1), 0) = 0;

    -- Lock any existing rows for the incoming job_keys so a concurrent get_job
    -- cannot lock an available row between the UPDATE and INSERT below.
    perform 1
    from :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
    inner join unnest(v_remaining_specs) spec on jobs.key = spec.job_key
    where spec.job_key is not null
    order by jobs.key
    for update of jobs;

    -- Ensure any locked jobs have their key cleared - in the case of locked
    -- existing job create a new job instead as it must have already started
    -- executing (i.e. it's world state is out of date, and the fact add_job
    -- has been called again implies there's new information that needs to be
    -- acted upon).
    -- Preserve attempts on locked batch jobs (array payload) because the new
    -- row only holds the newly added entries, not the in-flight batch entries.
    update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
    set
      key = null,
      attempts = case
        when json_typeof(jobs.payload) = 'array' then jobs.attempts
        else jobs.max_attempts
      end,
      updated_at = now()
    from unnest(v_remaining_specs) spec
    where spec.job_key is not null
    and jobs.key = spec.job_key
    and jobs.locked_at is not null;

    return query
    with upserted as (
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
          coalesce(spec.payload, '{}'::json),
          coalesce(spec.run_at, now()),
          coalesce(spec.max_attempts, 25),
          spec.job_key,
          coalesce(spec.priority, 0),
          (
            select jsonb_object_agg(flag, true)
            from unnest(spec.flags) as item(flag)
          )
        from unnest(v_remaining_specs) spec
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
      returning *
    )
    select * from upserted;

    select coalesce(array_agg(spec), array[]:::GRAPHILE_WORKER_SCHEMA.job_spec[])
    into v_remaining_specs
    from unnest(v_remaining_specs) spec
    where spec.job_key is not null
    and exists (
      select 1
      from :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
      where jobs.key = spec.job_key
      and jobs.locked_at is not null
    );
  end loop;
  return;
end;
$$;

CREATE OR REPLACE FUNCTION :GRAPHILE_WORKER_SCHEMA.force_unlock_workers(worker_ids text[]) RETURNS void
    LANGUAGE sql
    AS $$
delete from :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
where locked_by = any(worker_ids)
  and key is null
  and json_typeof(payload) != 'array'
  and attempts >= max_attempts
  and last_error is null;
update :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
update :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
$$;
