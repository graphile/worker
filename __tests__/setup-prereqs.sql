do $$
declare
  pg_version integer;
begin
  show server_version_num into pg_version;
  -- PostgreSQL 12 or below:
  if pg_version < 130000 then
    raise notice 'PostgreSQL % detected, installing pgcrypto for gen_random_uuid()...', pg_version / 10000;
    create extension if not exists pgcrypto with schema public;
  end if;
end
$$;
