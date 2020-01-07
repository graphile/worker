const { Pool } = require("pg");

const pgPool = new Pool({ connectionString: process.env.PERF_DATABASE_URL });

pgPool.query(
  `
    do $$
    begin
      perform graphile_worker.add_job('log_if_999', json_build_object('id', i)) from generate_series(1, 20000) i;
    end;
    $$ language plpgsql;
  `
);
