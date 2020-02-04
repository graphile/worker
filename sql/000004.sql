create function graphile_worker.fail_jobs(specs json) returns void as $$
begin
  with parsed_specs as (
    select
      el->>0 as worker_id,
      (el->>1)::bigint as job_id,
      el->>2 as error_message
    from json_array_elements(specs) el
  ), updated_jobs as (
    update graphile_worker.jobs
      set
        last_error = error_message,
        run_at = greatest(now(), run_at) + (exp(least(attempts, 10))::text || ' seconds')::interval,
        locked_by = null,
        locked_at = null
      from parsed_specs
      where id = job_id and jobs.locked_by = worker_id
      returning *
  ) update graphile_worker.job_queues
      set locked_by = null, locked_at = null
      from updated_jobs
      where job_queues.queue_name = updated_jobs.queue_name;

end;
$$ language plpgsql volatile strict;

create function graphile_worker.complete_jobs(specs json) returns void as $$
begin
  with parsed_specs as (
    select
      el->>0 as worker_id,
      (el->>1)::bigint as job_id
    from json_array_elements(specs) el
  ), updated_jobs as (
    delete from graphile_worker.jobs
      where id in (select job_id from parsed_specs)
      returning *
  ) update graphile_worker.job_queues
    set locked_by = null, locked_at = null
    from updated_jobs
    where job_queues.queue_name = updated_jobs.queue_name
    and job_queues.locked_by = (
      select worker_id from parsed_specs where job_id = updated_jobs.id
    );
end;
$$ language plpgsql;
