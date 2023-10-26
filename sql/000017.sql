create view :GRAPHILE_WORKER_SCHEMA.jobs as (
  select
    jobs.id,
    job_queues.queue_name,
    tasks.identifier as task_identifier,
    jobs.priority,
    jobs.run_at,
    jobs.attempts,
    jobs.max_attempts,
    jobs.last_error,
    jobs.created_at,
    jobs.updated_at,
    jobs.key,
    jobs.locked_at,
    jobs.locked_by,
    jobs.revision,
    jobs.flags
  from :GRAPHILE_WORKER_SCHEMA._private_jobs as jobs
  inner join :GRAPHILE_WORKER_SCHEMA._private_tasks as tasks
  on tasks.id = jobs.task_id
  left join :GRAPHILE_WORKER_SCHEMA._private_job_queues as job_queues
  on job_queues.id = jobs.job_queue_id
);
