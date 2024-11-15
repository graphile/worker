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
      jobs.push({ identifier: taskIdentifier, payload: { id: i } });
    }
    console.time(`Adding jobs`);
    while (jobs.length > 0) {
      const jobsSlice = jobs.splice(0, 1000000);
      const jobsString = JSON.stringify(jobsSlice);
      console.log(`Adding ${jobsSlice.length} jobs`);
      await pgPool.query(
        `select 1 from graphile_worker.add_jobs(array(select json_populate_recordset(null::graphile_worker.job_spec, $1::json)));`,
        [jobsString],
      );
      console.log(`...added`);
    }
    console.timeEnd("Adding jobs");
  }

  pgPool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
