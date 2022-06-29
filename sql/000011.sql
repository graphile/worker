drop function :GRAPHILE_WORKER_SCHEMA.complete_job;
drop function :GRAPHILE_WORKER_SCHEMA.fail_job;
drop function :GRAPHILE_WORKER_SCHEMA.get_job;

alter table :GRAPHILE_WORKER_SCHEMA.jobs
alter column attempts type int2,
alter column max_attempts type int2,
alter column priority type int2;

alter table :GRAPHILE_WORKER_SCHEMA.jobs add column is_available boolean not null
  generated always as (locked_at is null and attempts < max_attempts) stored;
alter table :GRAPHILE_WORKER_SCHEMA.job_queues add column is_available boolean not null
  generated always as (locked_at is null) stored;

create index job_queues_queue_name
on :GRAPHILE_WORKER_SCHEMA.job_queues
using btree (queue_name)
where (is_available = true);

drop index :GRAPHILE_WORKER_SCHEMA.jobs_priority_run_at_id_locked_at_without_failures_idx;
create index jobs_priority_run_at_id_locked_at_without_failures_idx
on :GRAPHILE_WORKER_SCHEMA.jobs
using btree (priority, run_at)
include (id, task_identifier)
where (is_available = true);
