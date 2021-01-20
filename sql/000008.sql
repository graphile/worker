create table :GRAPHILE_WORKER_SCHEMA.known_crontabs (
  identifier text not null primary key,
  known_since timestamptz not null,
  last_execution timestamptz
);
alter table :GRAPHILE_WORKER_SCHEMA.known_crontabs enable row level security;
