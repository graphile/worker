-- Tidy up from previous migrations
drop function :GRAPHILE_WORKER_SCHEMA.jobs__increase_job_queue_count();
drop function :GRAPHILE_WORKER_SCHEMA.jobs__decrease_job_queue_count();
drop function :GRAPHILE_WORKER_SCHEMA.tg__update_timestamp();

-- Add function to unlock all jobs from the given workers due to a crash or similar
create function :GRAPHILE_WORKER_SCHEMA.force_unlock_workers(worker_ids text[]) returns void as $$
update :GRAPHILE_WORKER_SCHEMA.jobs
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
update :GRAPHILE_WORKER_SCHEMA.job_queues
set locked_at = null, locked_by = null
where locked_by = any(worker_ids);
$$ language sql volatile;
