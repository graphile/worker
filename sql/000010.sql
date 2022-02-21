alter table :GRAPHILE_WORKER_SCHEMA.jobs alter column queue_name set default gen_random_uuid()::text;
