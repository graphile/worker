--! breaking-change
lock table :GRAPHILE_WORKER_SCHEMA.jobs;
lock table :GRAPHILE_WORKER_SCHEMA.job_queues;

-- If there's any locked jobs, abort via division by zero
select 1/(case when exists (
  select 1
  from :GRAPHILE_WORKER_SCHEMA.jobs
  where locked_at is not null
  and locked_at > NOW() - interval '4 hours'
) then 0 else 1 end);

alter table :GRAPHILE_WORKER_SCHEMA.jobs
alter column attempts type int2,
alter column max_attempts type int2,
alter column priority type int2;


drop function :GRAPHILE_WORKER_SCHEMA.complete_job;
drop function :GRAPHILE_WORKER_SCHEMA.fail_job;
drop function :GRAPHILE_WORKER_SCHEMA.get_job;



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

create index jobs_no_queue_index
  on :GRAPHILE_WORKER_SCHEMA.jobs
  using btree (priority, run_at)
  include (id, task_id)
  where (is_available = true and job_queue_id is null);

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
    attempts = jobs.max_attempts,
    updated_at = now()
  from unnest(specs) spec
  where spec.job_key is not null
  and jobs.key = spec.job_key
  and is_available is not true;

  -- TODO: is there a risk that a conflict could occur depending on the
  -- isolation level?

  return query insert into :GRAPHILE_WORKER_SCHEMA.jobs (
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
    inner join :GRAPHILE_WORKER_SCHEMA.tasks
    on tasks.identifier = spec.identifier
    left join :GRAPHILE_WORKER_SCHEMA.job_queues
    on job_queues.queue_name = spec.queue_name
  on conflict (key) do update set
    job_queue_id = excluded.job_queue_id,
    task_id = excluded.task_id,
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
    last_error = null,
    updated_at = now()
  where jobs.locked_at is null
  returning *;
end;
$$ language plpgsql;

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
      attempts = max_attempts,
      updated_at = now()
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
    attempts = jobs.max_attempts,
    updated_at = now()
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
      max_attempts = coalesce(reschedule_jobs.max_attempts, jobs.max_attempts),
      updated_at = now()
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
$$ language plpgsql;

-- Migrate over the old tables
insert into :GRAPHILE_WORKER_SCHEMA.job_queues (queue_name)
select distinct queue_name
from :GRAPHILE_WORKER_SCHEMA.jobs_legacy
where queue_name is not null
on conflict do nothing;

insert into :GRAPHILE_WORKER_SCHEMA.tasks (identifier)
select distinct task_identifier
from :GRAPHILE_WORKER_SCHEMA.jobs_legacy
on conflict do nothing;

insert into :GRAPHILE_WORKER_SCHEMA.jobs (
  job_queue_id,
  task_id,
  payload,
  priority,
  run_at,
  attempts,
  max_attempts,
  last_error,
  created_at,
  updated_at,
  key,
  revision,
  flags
)
  select
    job_queues.id,
    tasks.id,
    legacy.payload,
    legacy.priority,
    legacy.run_at,
    legacy.attempts,
    legacy.max_attempts,
    legacy.last_error,
    legacy.created_at,
    legacy.updated_at,
    legacy.key,
    legacy.revision,
    legacy.flags
  from :GRAPHILE_WORKER_SCHEMA.jobs_legacy legacy
  inner join :GRAPHILE_WORKER_SCHEMA.tasks
  on tasks.identifier = legacy.task_identifier
  left join :GRAPHILE_WORKER_SCHEMA.job_queues
  on job_queues.queue_name = legacy.queue_name;

drop table :GRAPHILE_WORKER_SCHEMA.jobs_legacy;
drop table :GRAPHILE_WORKER_SCHEMA.job_queues_legacy;

