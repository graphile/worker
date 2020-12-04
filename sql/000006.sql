create index jobs_priority_run_at_id_locked_at_without_failures_idx
  on :GRAPHILE_WORKER_SCHEMA.jobs (priority, run_at, id, locked_at)
  where attempts < max_attempts;

drop index :GRAPHILE_WORKER_SCHEMA.jobs_priority_run_at_id_idx;

