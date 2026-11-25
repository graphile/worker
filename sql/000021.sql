CREATE OR REPLACE FUNCTION :GRAPHILE_WORKER_SCHEMA.add_jobs(specs :GRAPHILE_WORKER_SCHEMA.job_spec[], job_key_preserve_run_at boolean DEFAULT false) RETURNS SETOF :GRAPHILE_WORKER_SCHEMA._private_jobs
    LANGUAGE plpgsql
    AS $$
declare
  v_key text;
begin
  -- Hold each key until commit so another add_jobs call cannot insert the same
  -- key between this function's locked-job UPDATE and INSERT. Sort keys to
  -- keep concurrent batches from acquiring the same locks in opposite orders.
  for v_key in
    select distinct spec.job_key
    from unnest(specs) spec
    where spec.job_key is not null
    order by spec.job_key
  loop
    perform pg_advisory_xact_lock(hashtextextended('graphile_worker:add_jobs:' || v_key, 0));
  end loop;

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

  -- WARNING: this count is not 100% accurate; 'on conflict' clause will cause it to be an overestimate
  perform pg_notify('jobs:insert', '{"r":' || random()::text || ',"count":' || array_length(specs, 1)::text || '}');

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
