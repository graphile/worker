-- TODO evaluate perf re partial indexing instead of full unique
alter table graphile_worker.jobs add column key text unique;

alter table graphile_worker.jobs add locked_at timestamptz;
alter table graphile_worker.jobs add locked_by text;

-- update add_job behaviour to meet new requirements
drop function if exists graphile_worker.add_job(identifier text,
  payload json,
  queue_name text,
  run_at timestamptz,
  max_attempts int
);
create function graphile_worker.add_job(
  identifier text,
  payload json = null,
  queue_name text = null,
  run_at timestamptz = null,
  max_attempts int = null,
  job_key text = null
) returns graphile_worker.jobs as $$
declare
  v_job graphile_worker.jobs;
begin
  if job_key is null then
    insert into graphile_worker.jobs(task_identifier, payload, queue_name, run_at, max_attempts)
      values(
        identifier,
        coalesce(payload, '{}'),
        coalesce(queue_name, public.gen_random_uuid()::text),
        coalesce(run_at, now()),
        coalesce(max_attempts, 25)
      )
      returning *
      into v_job;
  else
    insert into graphile_worker.jobs (task_identifier, payload, queue_name, run_at, max_attempts, key)
      values(
        identifier,
        coalesce(payload, '{}'),
        coalesce(queue_name, public.gen_random_uuid()::text),
        coalesce(run_at, now()),
        coalesce(max_attempts, 25),
        job_key
      )
      on conflict (key) do update set
        -- update job details if provided, otherwise maintain existing value
        task_identifier=coalesce(add_job.identifier, jobs.task_identifier),
        payload=coalesce(add_job.payload, jobs.payload),
        queue_name=coalesce(add_job.queue_name, jobs.queue_name),
        max_attempts=coalesce(add_job.max_attempts, jobs.max_attempts),

        -- update run_at if argument is provided. If not, and there has been an
        -- error, assume run_at reflects the error retry backoff, so reset it.
        -- If no errors, maintain existing value by default
        run_at=coalesce(
          add_job.run_at,
          (case when jobs.attempts > 0
            then now()
            else jobs.run_at
          end)
        ),

        -- always reset error/retry state
        attempts=0,
        last_error=null
      where jobs.locked_at is null
      returning *
      into v_job;

    -- if the returned id is null, assume job is already locked for processing
    -- and couldn't be updated
    if v_job.id is null then
      -- remove existing key to allow a new one to be inserted, and prevent any
      -- subsequent retries by bumping attempts to the max allowed
      update graphile_worker.jobs set
        key = null,
        attempts = jobs.max_attempts
      where key = job_key;

      -- insert the new job. Assume no conflicts due to the update above
      insert into graphile_worker.jobs(task_identifier, payload, queue_name, run_at, max_attempts, key)
        values(
          identifier,
          coalesce(payload, '{}'),
          coalesce(queue_name, public.gen_random_uuid()::text),
          coalesce(run_at, now()),
          coalesce(max_attempts, 25),
          job_key
        )
        returning *
        into v_job;
    end if;
  end if;
  return v_job;
end;
$$ language plpgsql;


--- implement new remove_job function

create function graphile_worker.remove_job(
  job_key text
) returns graphile_worker.jobs as $$
  delete from graphile_worker.jobs
    where key = job_key
    and locked_at is null
  returning *;
$$ language sql;


-- Update other functions to handle locked_at denormalisation

create or replace function graphile_worker.get_job(worker_id text, task_identifiers text[] = null, job_expiry interval = interval '4 hours') returns graphile_worker.jobs as $$
declare
  v_job_id bigint;
  v_queue_name text;
  v_default_job_max_attempts text = '25';
  v_row graphile_worker.jobs;
  v_now timestamptz = now();
begin
  if worker_id is null or length(worker_id) < 10 then
    raise exception 'invalid worker id';
  end if;

  select job_queues.queue_name, jobs.id into v_queue_name, v_job_id
    from graphile_worker.jobs
    inner join graphile_worker.job_queues using (queue_name)
    where (job_queues.locked_at is null or job_queues.locked_at < (v_now - job_expiry))
    and run_at <= v_now
    and attempts < max_attempts
    and (task_identifiers is null or task_identifier = any(task_identifiers))
    order by priority asc, run_at asc, id asc
    limit 1
    for update of job_queues
    skip locked;

  if v_queue_name is null then
    return null;
  end if;

  update graphile_worker.job_queues
    set
      locked_by = worker_id,
      locked_at = v_now
    where job_queues.queue_name = v_queue_name;

  update graphile_worker.jobs
    set
      attempts = attempts + 1,
      locked_by = worker_id,
      locked_at = v_now
    where id = v_job_id
    returning * into v_row;

  return v_row;
end;
$$ language plpgsql;

-- I was unsuccessful, re-schedule the job please
create or replace function graphile_worker.fail_job(worker_id text, job_id bigint, error_message text) returns graphile_worker.jobs as $$
declare
  v_row graphile_worker.jobs;
begin
  update graphile_worker.jobs
    set
      last_error = error_message,
      run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
      locked_by = null,
      locked_at = null
    where id = job_id
    returning * into v_row;

  update graphile_worker.job_queues
    set locked_by = null, locked_at = null
    where queue_name = v_row.queue_name and locked_by = worker_id;

  return v_row;
end;
$$ language plpgsql;

