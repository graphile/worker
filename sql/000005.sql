create or replace function :GRAPHILE_WORKER_SCHEMA.get_jobs(
  worker_id text,
  task_identifiers text[] = null,
  job_expiry interval = interval '4 hours'
) returns setof :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_jobs jsonb[];
  v_now timestamptz = now();
begin
  if worker_id is null or length(worker_id) < 10 then
    raise exception 'invalid worker id';
  end if;

  select array(
    select jsonb_build_object(
      'queue_name',
      jobs.queue_name,
      'id',
      jobs.id
    )
      from :GRAPHILE_WORKER_SCHEMA.jobs
      where (jobs.locked_at is null or jobs.locked_at < (v_now - job_expiry))
      and (
        jobs.queue_name is null
      or
        exists (
          select 1
          from :GRAPHILE_WORKER_SCHEMA.job_queues
          where job_queues.queue_name = jobs.queue_name
          and (job_queues.locked_at is null or job_queues.locked_at < (v_now - job_expiry))
          for update
          skip locked
        )
      )
      and run_at <= v_now
      and attempts < max_attempts
      and (task_identifiers is null or task_identifier = any(task_identifiers))
      order by priority asc, run_at asc, id asc
      limit 10
      for update
      skip locked
  ) into v_jobs;

  -- if v_job_id is null then
  --   return null;
  -- end if;

  update :GRAPHILE_WORKER_SCHEMA.job_queues
    set
      locked_by = worker_id,
      locked_at = v_now
    where job_queues.queue_name = any(select (j->>'queue_name') from unnest(v_jobs) j);

  return query update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      attempts = attempts + 1,
      locked_by = worker_id,
      locked_at = v_now
    where id = any(select (j->>'id')::bigint from unnest(v_jobs) j)
    returning *;
end;
$$ language plpgsql volatile;


create or replace function :GRAPHILE_WORKER_SCHEMA.complete_batch(
  worker_id text,
  success_ids bigint[],
  failures json[] -- format {"id": string, "message": string}
) returns void as $$
declare
  v_row :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  with failures as (
    update :GRAPHILE_WORKER_SCHEMA.jobs
      set
        last_error = f->>'error_message',
        run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
        locked_by = null,
        locked_at = null
      from unnest(failures) f
      where id = (f->>'id')::bigint and locked_by = worker_id
      returning queue_name
  )
  update :GRAPHILE_WORKER_SCHEMA.job_queues jq
    set locked_by = null, locked_at = null
    where exists (
      select 1
      from unnest(failures) f
      where jq.queue_name = f->>'queue_name'
    ) and locked_by = worker_id;

  with successes as (
    delete from :GRAPHILE_WORKER_SCHEMA.jobs
      where id = any(success_ids)
    returning queue_name
  )
  update :GRAPHILE_WORKER_SCHEMA.job_queues jq
    set locked_by = null, locked_at = null
    where exists (
      select 1
      from successes s
      where jq.queue_name = s.queue_name
    ) and locked_by = worker_id;

end;
$$ language plpgsql volatile strict;



