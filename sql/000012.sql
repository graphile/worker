drop trigger _900_notify_worker on :GRAPHILE_WORKER_SCHEMA.jobs;
drop function :GRAPHILE_WORKER_SCHEMA.add_job;
drop function :GRAPHILE_WORKER_SCHEMA.complete_jobs;
drop function :GRAPHILE_WORKER_SCHEMA.permanently_fail_jobs;
drop function :GRAPHILE_WORKER_SCHEMA.remove_job;
drop function :GRAPHILE_WORKER_SCHEMA.reschedule_jobs;
drop function :GRAPHILE_WORKER_SCHEMA.tg_jobs__notify_new_jobs;
alter table :GRAPHILE_WORKER_SCHEMA.jobs rename to jobs_legacy;
alter table :GRAPHILE_WORKER_SCHEMA.job_queues rename to job_queues_legacy;

create table :GRAPHILE_WORKER_SCHEMA.job_queues (
  id int primary key generated always as identity,
  queue_name text not null unique check (length(queue_name) <= 128),
  locked_at timestamptz,
  locked_by text,
  is_available boolean generated always as ((locked_at is null)) stored not null
);
alter table :GRAPHILE_WORKER_SCHEMA.job_queues enable row level security;

create table :GRAPHILE_WORKER_SCHEMA.tasks (
  id int primary key generated always as identity,
  identifier text not null unique check (length(identifier) <= 128)
);
alter table :GRAPHILE_WORKER_SCHEMA.tasks enable row level security;

create table :GRAPHILE_WORKER_SCHEMA.jobs (
  id bigint primary key generated always as identity,
  job_queue_id int null, -- not adding 'references' to eke out more performance
  task_id int not null,
  payload json default '{}'::json not null,
  priority smallint default 0 not null,
  run_at timestamptz default now() not null,
  attempts smallint default 0 not null,
  max_attempts smallint default 25 not null constraint jobs_max_attempts_check check (max_attempts >= 1),
  last_error text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  key text unique constraint jobs_key_check check (length(key) > 0 and length(key) <= 512),
  locked_at timestamptz,
  locked_by text,
  revision integer default 0 not null,
  flags jsonb,
  is_available boolean generated always as (((locked_at is null) and (attempts < max_attempts))) stored not null
);
alter table :GRAPHILE_WORKER_SCHEMA.jobs enable row level security;

create index jobs_main_index
  on :GRAPHILE_WORKER_SCHEMA.jobs
  using btree (priority, run_at)
  include (id, task_id, job_queue_id)
  where (is_available = true);

create type :GRAPHILE_WORKER_SCHEMA.job_spec as (
  identifier text,
  payload json,
  queue_name text,
  run_at timestamptz,
  max_attempts integer,
  job_key text,
  priority integer,
  flags text[]
);

create function :GRAPHILE_WORKER_SCHEMA.add_jobs(
  specs :GRAPHILE_WORKER_SCHEMA.job_spec[],
  job_key_preserve_run_at boolean default false
)
returns setof :GRAPHILE_WORKER_SCHEMA.jobs
as $$
begin
  -- Ensure all the tasks exist
  insert into :GRAPHILE_WORKER_SCHEMA.tasks (identifier)
  select distinct spec.identifier
  from unnest(specs) spec
  on conflict do nothing;

  -- Ensure all the queues exist
  insert into :GRAPHILE_WORKER_SCHEMA.job_queues (queue_name)
  select distinct spec.queue_name
  from unnest(specs) spec
  where spec.queue_name is not null
  on conflict do nothing;

  -- Ensure any locked jobs have their key cleared - in the case of locked
  -- existing job create a new job instead as it must have already started
  -- executing (i.e. it's world state is out of date, and the fact add_job
  -- has been called again implies there's new information that needs to be
  -- acted upon).
  update :GRAPHILE_WORKER_SCHEMA.jobs
  set
    key = null,
    attempts = jobs.max_attempts
  from unnest(specs) spec
  where spec.job_key is not null
  and jobs.key = spec.job_key;

  -- TODO: is there a risk that a conflict could occur depending on the
  -- isolation level?

  return query insert into :GRAPHILE_WORKER_SCHEMA.jobs (
    task_id,
    job_queue_id,
    payload,
    run_at,
    max_attempts,
    key,
    priority,
    flags
  )
    select
      tasks.id,
      job_queues.id,
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
    inner join :GRAPHILE_WORKER_SCHEMA.tasks
    on tasks.identifier = spec.identifier
    left join :GRAPHILE_WORKER_SCHEMA.job_queues
    on job_queues.queue_name = spec.queue_name
  on conflict (key) do update set
    task_id = excluded.task_id,
    job_queue_id = excluded.job_queue_id,
    payload = excluded.payload,
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
    last_error = null
  where jobs.locked_at is null
  returning *;
end;
$$ language plpgsql;

create function :GRAPHILE_WORKER_SCHEMA.add_job_unsafe_dedupe(
  spec :GRAPHILE_WORKER_SCHEMA.job_spec
)
returns :GRAPHILE_WORKER_SCHEMA.jobs
as $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  -- Ensure all the tasks exist
  insert into :GRAPHILE_WORKER_SCHEMA.tasks (identifier)
  select distinct spec.identifier
  on conflict do nothing;

  -- Ensure all the queues exist
  if spec.queue_name is not null then
    insert into :GRAPHILE_WORKER_SCHEMA.job_queues (queue_name)
    select distinct spec.queue_name
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
    task_id,
    job_queue_id,
    payload,
    run_at,
    max_attempts,
    key,
    priority,
    flags
  )
    select
      tasks.id,
      job_queues.id,
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
    inner join :GRAPHILE_WORKER_SCHEMA.tasks
    on tasks.identifier = spec.identifier
    left join :GRAPHILE_WORKER_SCHEMA.job_queues
    on job_queues.queue_name = spec.queue_name
  on conflict (key)
    -- Bump the revision so that there's something to return
    do update set revision = jobs.revision + 1
    returning *
    into v_job;
  return v_job;
end;
$$ language plpgsql strict;


create function :GRAPHILE_WORKER_SCHEMA.complete_jobs(job_ids bigint[])
returns setof :GRAPHILE_WORKER_SCHEMA.jobs
as $$
  delete from :GRAPHILE_WORKER_SCHEMA.jobs
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < now() - interval '4 hours'
    )
    returning *;
$$ language sql;

create function :GRAPHILE_WORKER_SCHEMA.permanently_fail_jobs(
  job_ids bigint[],
  error_message text default null::text
)
returns setof :GRAPHILE_WORKER_SCHEMA.jobs
as $$
  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      last_error = coalesce(error_message, 'Manually marked as failed'),
      attempts = max_attempts
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$ language sql;

create function :GRAPHILE_WORKER_SCHEMA.remove_job(job_key text)
returns :GRAPHILE_WORKER_SCHEMA.jobs
as $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  -- Delete job if not locked
  delete from :GRAPHILE_WORKER_SCHEMA.jobs
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
  update :GRAPHILE_WORKER_SCHEMA.jobs
  set
    key = null,
    attempts = jobs.max_attempts
  where key = job_key
  returning * into v_job;
  return v_job;
end;
$$ language plpgsql strict;

create function :GRAPHILE_WORKER_SCHEMA.reschedule_jobs(
  job_ids bigint[],
  run_at timestamp with time zone default null::timestamp with time zone,
  priority integer default null::integer,
  attempts integer default null::integer,
  max_attempts integer default null::integer
) returns setof :GRAPHILE_WORKER_SCHEMA.jobs
as $$
  update :GRAPHILE_WORKER_SCHEMA.jobs
    set
      run_at = coalesce(reschedule_jobs.run_at, jobs.run_at),
      priority = coalesce(reschedule_jobs.priority, jobs.priority),
      attempts = coalesce(reschedule_jobs.attempts, jobs.attempts),
      max_attempts = coalesce(reschedule_jobs.max_attempts, jobs.max_attempts)
    where id = any(job_ids)
    and (
      locked_at is null
    or
      locked_at < NOW() - interval '4 hours'
    )
    returning *;
$$ language sql;

create function :GRAPHILE_WORKER_SCHEMA.tg_jobs__after_insert() returns trigger
as $$
begin
  perform pg_notify('jobs:insert', '');
  return new;
end;
$$ language plpgsql;
create trigger _900_after_insert
after insert on :GRAPHILE_WORKER_SCHEMA.jobs
for each statement
execute procedure :GRAPHILE_WORKER_SCHEMA.tg_jobs__after_insert();

create function :GRAPHILE_WORKER_SCHEMA.add_job(
  identifier text,
  payload json default null::json,
  queue_name text default null::text,
  run_at timestamp with time zone default null::timestamp with time zone,
  max_attempts integer default null::integer,
  job_key text default null::text,
  priority integer default null::integer,
  flags text[] default null::text[],
  job_key_mode text default 'replace'::text
) returns :GRAPHILE_WORKER_SCHEMA.jobs as $$
declare
  v_job :GRAPHILE_WORKER_SCHEMA.jobs;
begin
  if (job_key_mode is null or job_key_mode in ('replace', 'preserve_run_at')) then
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
  elsif job_key is not null and job_key_mode = 'unsafe_dedupe' then
    return :GRAPHILE_WORKER_SCHEMA.add_job_unsafe_dedupe(
      (
        identifier,
        payload,
        queue_name,
        run_at,
        max_attempts,
        job_key,
        priority,
        flags
      ):::GRAPHILE_WORKER_SCHEMA.job_spec
    );
  elsif job_key is not null then
    raise exception 'Invalid job_key_mode value, expected ''replace'', ''preserve_run_at'' or ''unsafe_dedupe''.' using errcode = 'GWBKM';
  end if;
end;
$$ language plpgsql;
