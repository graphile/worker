drop function :GRAPHILE_WORKER_SCHEMA.get_job(text, text[], interval, text[]);
create function :GRAPHILE_WORKER_SCHEMA.get_job(
  worker_id text,
  task_identifiers text[] = null,
  job_expiry interval = interval '4 hours',
  forbidden_flags text[] = null,
  now timestamptz = now()
) returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_job_id bigint;
  v_queue_name text;
  v_row :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  if worker_id is null or length(worker_id) < 10 then
    raise exception 'invalid worker id';
  end if;

  select jobs.queue_name, jobs.id into v_queue_name, v_job_id
    from :GRAPHILE_WORKER_SCHEMA.jobs
    where (jobs.locked_at is null or jobs.locked_at < (now - job_expiry))
    and (
      jobs.queue_name is null
    or
      exists (
        select 1
        from :GRAPHILE_WORKER_SCHEMA.job_queues
        where job_queues.queue_name = jobs.queue_name
        and (job_queues.locked_at is null or job_queues.locked_at < (now - job_expiry))
        for update
        skip locked
      )
    )
    and run_at <= now
    and attempts < max_attempts
    and (task_identifiers is null or task_identifier = any(task_identifiers))
    and (forbidden_flags is null or (flags ?| forbidden_flags) is not true)
    order by priority asc, run_at asc, id asc
    limit 1
    for update
    skip locked;

  if v_job_id is null then
    return null;
  end if;

  if v_queue_name is not null then
    update :GRAPHILE_WORKER_SCHEMA.job_queues
      set
        locked_by = worker_id,
        locked_at = now
      where job_queues.queue_name = v_queue_name;
  end if;

  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      attempts = attempts + 1,
      locked_by = worker_id,
      locked_at = now
    where id = v_job_id
    returning * into v_row;

  return v_row;
end;
$$ language plpgsql volatile;
