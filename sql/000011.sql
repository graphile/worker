drop function graphile_worker.complete_job;
drop function graphile_worker.fail_job;
drop function graphile_worker.get_job;

alter table graphile_worker.jobs
alter column attempts type int2,
alter column max_attempts type int2,
alter column priority type int2;

alter table graphile_worker.jobs add column is_available boolean not null
  generated always as (locked_at is null and attempts < max_attempts) stored;
alter table graphile_worker.job_queues add column is_available boolean not null
  generated always as (locked_at is null) stored;

create index job_queues_queue_name
on graphile_worker.job_queues
using btree (queue_name)
where (is_available = true);

drop index graphile_worker.jobs_priority_run_at_id_locked_at_without_failures_idx;
create index jobs_priority_run_at_id_locked_at_without_failures_idx
on graphile_worker.jobs
using btree (priority, run_at)
include (id, task_identifier)
where (is_available = true);
