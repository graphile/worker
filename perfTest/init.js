const { Pool } = require("pg");

const pgPool = new Pool({ connectionString: process.env.PERF_DATABASE_URL });

const jobCount = parseInt(process.argv[2], 10) || 1;
const taskIdentifier = process.argv[3] || "log_if_999";

if (!taskIdentifier.match(/^[a-zA-Z0-9_]+$/)) {
  // Validate so we can do raw SQL
  throw new Error("Disallowed task identifier");
}

async function main() {
  if (taskIdentifier === "stuck") {
    await pgPool.query(
      `
        do $$
        begin
          perform graphile_worker.add_job(
            '${taskIdentifier}'
            ,json_build_object('id', i)
            --,queue_name := '${taskIdentifier}'
          ) from generate_series(1, ${jobCount}) i;

          -- update graphile_worker.job_queues
          -- set locked_at = now(), locked_by = 'fakelock'
          -- where queue_name = '${taskIdentifier}';
        end;
        $$ language plpgsql;
      `,
    );
  } else {
    await pgPool.query(
      `
        do $$
        begin
          perform graphile_worker.add_job(
            '${taskIdentifier}',
            json_build_object('id', i)
          ) from generate_series(1, ${jobCount}) i;
        end;
        $$ language plpgsql;
      `,
    );
  }

  pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
