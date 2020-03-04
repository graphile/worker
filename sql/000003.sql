alter table :GRAPHILE_WORKER_SCHEMA.jobs alter column queue_name drop not null;

create or replace function :GRAPHILE_WORKER_SCHEMA.add_job(
  identifier text,
  payload json = '{}',
  queue_name text = null,
  run_at timestamptz = now(),
  max_attempts int = 25,
  job_key text = null
) returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  if job_key is not null then
    -- Upsert job
    insert into :GRAPHILE_WORKER_SCHEMA.jobs (task_identifier, payload, queue_name, run_at, max_attempts, key)
      values(
        identifier,
        payload,
        queue_name,
        run_at,
        max_attempts,
        job_key
      )
      on conflict (key) do update set
        task_identifier=excluded.task_identifier,
        payload=excluded.payload,
        queue_name=excluded.queue_name,
        max_attempts=excluded.max_attempts,
        run_at=excluded.run_at,

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
  insert into :GRAPHILE_WORKER_SCHEMA.jobs(task_identifier, payload, queue_name, run_at, max_attempts, key)
    values(
      identifier,
      payload,
      queue_name,
      run_at,
      max_attempts,
      job_key
    )
    returning *
    into v_job;

  return v_job;
end;
$$ language plpgsql volatile;

create or replace function :GRAPHILE_WORKER_SCHEMA.get_job(worker_id text, task_identifiers text[] = null, job_expiry interval = interval '4 hours') returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_job_id bigint;
  v_queue_name text;
  v_row :GRAPHILE_WORKER_SCHEMA.jobs;
  v_now timestamptz = now();
begin
  if worker_id is null or length(worker_id) < 10 then
    raise exception 'invalid worker id';
  end if;

  select jobs.queue_name, jobs.id into v_queue_name, v_job_id
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
        locked_at = v_now
      where job_queues.queue_name = v_queue_name;
  end if;

  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      attempts = attempts + 1,
      locked_by = worker_id,
      locked_at = v_now
    where id = v_job_id
    returning * into v_row;

  return v_row;
end;
$$ language plpgsql volatile;

create or replace function :GRAPHILE_WORKER_SCHEMA.fail_job(worker_id text, job_id bigint, error_message text) returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_row :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      last_error = error_message,
      run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
      locked_by = null,
      locked_at = null
    where id = job_id and locked_by = worker_id
    returning * into v_row;

  if v_row.queue_name is not null then
    update :GRAPHILE_WORKER_SCHEMA.job_queues
      set locked_by = null, locked_at = null
      where queue_name = v_row.queue_name and locked_by = worker_id;
  end if;

  return v_row;
end;
$$ language plpgsql volatile strict;

create or replace function :GRAPHILE_WORKER_SCHEMA.complete_job(worker_id text, job_id bigint) returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_row :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  delete from :GRAPHILE_WORKER_SCHEMA.jobs
    where id = job_id
    returning * into v_row;

  if v_row.queue_name is not null then
    update :GRAPHILE_WORKER_SCHEMA.job_queues
      set locked_by = null, locked_at = null
      where queue_name = v_row.queue_name and locked_by = worker_id;
  end if;

  return v_row;
end;
$$ language plpgsql;

drop trigger _500_increase_job_queue_count on :GRAPHILE_WORKER_SCHEMA.jobs;
drop trigger _500_decrease_job_queue_count on :GRAPHILE_WORKER_SCHEMA.jobs;
drop trigger _500_increase_job_queue_count_update on :GRAPHILE_WORKER_SCHEMA.jobs;
drop trigger _500_decrease_job_queue_count_update on :GRAPHILE_WORKER_SCHEMA.jobs;
create trigger _500_increase_job_queue_count after insert on :GRAPHILE_WORKER_SCHEMA.jobs for each row when (NEW.queue_name is not null) execute procedure :GRAPHILE_WORKER_SCHEMA.jobs__increase_job_queue_count();
create trigger _500_decrease_job_queue_count after delete on :GRAPHILE_WORKER_SCHEMA.jobs for each row when (OLD.queue_name is not null) execute procedure :GRAPHILE_WORKER_SCHEMA.jobs__decrease_job_queue_count();
create trigger _500_increase_job_queue_count_update after update of queue_name on :GRAPHILE_WORKER_SCHEMA.jobs for each row when (NEW.queue_name is distinct from OLD.queue_name AND NEW.queue_name is not null) execute procedure :GRAPHILE_WORKER_SCHEMA.jobs__increase_job_queue_count();
create trigger _500_decrease_job_queue_count_update after update of queue_name on :GRAPHILE_WORKER_SCHEMA.jobs for each row when (NEW.queue_name is distinct from OLD.queue_name AND OLD.queue_name is not null) execute procedure :GRAPHILE_WORKER_SCHEMA.jobs__decrease_job_queue_count();
