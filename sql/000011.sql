-- alter table graphile_worker.jobs add column ordinal char(27);
-- 
-- create function graphile_worker.tg_jobs__set_ordinal() returns trigger as $$
-- begin
--   -- lexicographically sortable
--   NEW.ordinal =
--     -- Guaranteed not to be negative, guaranteed to be 10 digits long (leading zeros)
--     lpad((NEW.priority::bigint + 2147483648)::text, 10, '0') ||
--     -- Guaranteed to be the same in all timezones '01234567890123456'
--     lpad(((extract(epoch from NEW.run_at) * 1000000::double precision)::bigint)::text, 17, '0');
--   return NEW;
-- end;
-- $$ language plpgsql volatile;
-- create trigger _200_set_ordinal before
--   insert
--   or update of priority, run_at
-- on graphile_worker.jobs
-- for each row execute procedure graphile_worker.tg_jobs__set_ordinal();
-- 
-- update graphile_worker.jobs set ordinal =
--     -- COPY OF THE ABOVE!
--     lpad((priority::bigint + 2147483648)::text, 10, '0') ||
--     lpad(((extract(epoch from run_at) * 1000000::double precision)::bigint)::text, 17, '0');
-- alter table graphile_worker.jobs alter column ordinal set not null;

drop index graphile_worker.jobs_priority_run_at_id_locked_at_without_failures_idx;

-- create index jobs_ordinal_task_identifier_idx_with_queue
-- on graphile_worker.jobs
-- using btree (priority asc, run_at asc)
-- include (queue_name, task_identifier)
-- where (queue_name is not null and attempts < max_attempts);

-- create index jobs_ordinal_task_identifier_idx_no_queue
-- on graphile_worker.jobs
-- using btree (priority asc, run_at asc)
-- where (queue_name is null and attempts < max_attempts);

create index jobs_idx_with_queue
on graphile_worker.jobs
using btree (task_identifier, priority asc, run_at asc)
include (queue_name)
where (queue_name is not null and attempts < max_attempts and locked_at is null);

create index jobs_idx_no_queue
on graphile_worker.jobs
using btree (task_identifier, priority asc, run_at asc)
where (queue_name is null and attempts < max_attempts and locked_at is null);


-- create index jobs_ordinal_task_identifier_idx_no_queue
-- on graphile_worker.jobs
-- using btree (ordinal asc)
-- where (queue_name is null and attempts < max_attempts);

create or replace function graphile_worker.get_job(
  worker_id text,
  task_identifiers text[] default null::text[],
  job_expiry interval default '04:00:00'::interval,
  forbidden_flags text[] default null::text[],
  now timestamp with time zone default now()
) returns graphile_worker.jobs language plpgsql
as $$
declare
  v_job_id bigint;
  v_queue_name text;
  v_row "graphile_worker".jobs;
begin
  if worker_id is null or length(worker_id) < 10 then
    raise exception 'invalid worker id';
  end if;
  select jobs.queue_name, jobs.id into v_queue_name, v_job_id
    from "graphile_worker".jobs
    where jobs.locked_at is null -- or jobs.locked_at < (now - job_expiry))
    and (
      jobs.queue_name is null
    -- or
    --   exists (
    --     select 1
    --     from "graphile_worker".job_queues
    --     where job_queues.queue_name = jobs.queue_name
    --     and (job_queues.locked_at is null or job_queues.locked_at < (now - job_expiry))
    --     for update
    --     skip locked
    --   )
    )
    and run_at <= now
    and attempts < max_attempts
    -- and (task_identifiers is null or task_identifier = any(task_identifiers))
    and task_identifier = any(task_identifiers)
    -- and (forbidden_flags is null or (flags ?| forbidden_flags) is not true)
    order by priority asc, run_at asc
    limit 1
    for update
    skip locked;
  if v_job_id is null then
    return null;
  end if;
  if v_queue_name is not null then
    update "graphile_worker".job_queues
      set
        locked_by = worker_id,
        locked_at = now
      where job_queues.queue_name = v_queue_name;
  end if;
  update "graphile_worker".jobs
    set
      attempts = attempts + 1,
      locked_by = worker_id,
      locked_at = now
    where id = v_job_id
    returning * into v_row;
  return v_row;
end;
$$;
