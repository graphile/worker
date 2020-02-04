const { Pool } = require("pg");

const pgPool = new Pool({ connectionString: process.env.PERF_DATABASE_URL });

const jobCount = parseInt(process.argv[2], 10) || 1;

pgPool.query(
  `
    do $$
    begin
      perform graphile_worker.add_job('log_if_999', json_build_object('id', i)) from generate_series(1, ${jobCount}) i;
    end;
    $$ language plpgsql;
  `
);
