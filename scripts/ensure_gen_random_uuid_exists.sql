do $$
declare
  server_version_num integer;
  server_version text;
begin
  select current_setting('server_version_num'), current_setting('server_version')
  into server_version_num, server_version;
  -- PostgreSQL 12 or below:
  if server_version_num < 130000 then
    raise info 'PostgreSQL % detected, pgcrypto will be installed.', server_version;
    create extension pgcrypto with schema public;
  end if;
end
$$;
