drop function graphile_worker.complete_job;
drop function graphile_worker.fail_job;
drop function graphile_worker.get_job;

alter table graphile_worker.jobs
alter column attempts type int2,
alter column max_attempts type int2,
alter column priority type int2;

create index job_queues_queue_name
on graphile_worker.job_queues
using btree (queue_name);

drop index graphile_worker.jobs_priority_run_at_id_locked_at_without_failures_idx;
create index jobs_priority_run_at_id_locked_at_without_failures_idx
on graphile_worker.jobs
using btree (priority, run_at, locked_at)
include (id, task_identifier)
where (attempts < max_attempts);
