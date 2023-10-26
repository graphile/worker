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
      `\
do $$
begin
  perform graphile_worker.add_jobs(
    (
      select array_agg(json_populate_record(null::graphile_worker.job_spec, json_build_object(
        'identifier', '${taskIdentifier}'
        ,'payload', json_build_object('id', i)
        ,'queue_name', '${taskIdentifier}' || ((i % 2)::text)
      )))
      from generate_series(1, ${jobCount}) i
    )
  );

  update graphile_worker._private_job_queues as job_queues
  set locked_at = now(), locked_by = 'fakelock'
  where queue_name like '${taskIdentifier}%';
end;
$$ language plpgsql;`,
    );
  } else {
    const jobs = [];
    for (let i = 0; i < jobCount; i++) {
      jobs.push(
        `("${taskIdentifier.replace(
          /["\\]/g,
          "\\$&",
        )}","{\\"id\\":${i}}",,,,,,)`,
      );
    }
    const jobsString = `{"${jobs
      .map((j) => j.replace(/["\\]/g, "\\$&"))
      .join('","')}"}`;
    console.time("Adding jobs");
    await pgPool.query(
      `select graphile_worker.add_jobs($1::graphile_worker.job_spec[]);`,
      [jobsString],
    );
    console.timeEnd("Adding jobs");
  }

  pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
