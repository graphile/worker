import pg from "pg";

import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  getJobs,
  reset,
  withPgClient,
} from "./helpers.ts";

const schema = ESCAPED_GRAPHILE_WORKER_SCHEMA;
const barrierKey = [771023, 580] as const;

async function waitForAdvisoryWait(observer: pg.PoolClient, pid: number) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const { rows } = await observer.query<{
      wait_event_type: string | null;
      wait_event: string | null;
    }>(
      "select wait_event_type, wait_event from pg_stat_activity where pid = $1",
      [pid],
    );
    if (
      rows[0]?.wait_event_type === "Lock" &&
      rows[0].wait_event === "advisory"
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Backend ${pid} did not reach the advisory lock`);
}

test(
  "a keyed add_job still returns a job when another call inserts a locked job between UPDATE and INSERT",
  () =>
    withPgClient(async (observer, { TEST_CONNECTION_STRING }) => {
      await reset(observer, {});
      await observer.query(
        `insert into ${schema}._private_tasks (identifier) values ('test_task')`,
      );
      // Pause only the second call just before its INSERT. This leaves the
      // production add_jobs function intact while forcing the conflict window.
      await observer.query(`
      create function ${schema}.test_keyed_add_insert_barrier() returns trigger
      language plpgsql as $$
      begin
        if new.payload->>'test_keyed_add' = 'second' then
          perform pg_advisory_xact_lock(${barrierKey[0]}, ${barrierKey[1]});
        end if;
        return new;
      end;
      $$;
      create trigger test_keyed_add_insert_barrier
      before insert on ${schema}._private_jobs
      for each row execute function ${schema}.test_keyed_add_insert_barrier();
    `);

      const gate = new pg.Client({ connectionString: TEST_CONNECTION_STRING });
      const first = new pg.Client({ connectionString: TEST_CONNECTION_STRING });
      const second = new pg.Client({
        connectionString: TEST_CONNECTION_STRING,
      });
      await Promise.all([gate.connect(), first.connect(), second.connect()]);
      const jobKey = "keyed-add-race";
      const add = (client: pg.Client, marker: string) =>
        client.query<{ id: string | null }>(
          `select id from ${schema}.add_job('test_task', $1::json, null, null, null, $2)`,
          [JSON.stringify({ test_keyed_add: marker }), jobKey],
        );

      try {
        await gate.query("select pg_advisory_lock($1, $2)", barrierKey);
        const { rows: secondPidRows } = await second.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        const secondCall = add(second, "second");
        await waitForAdvisoryWait(observer, secondPidRows[0].pid);

        const { rows: firstPidRows } = await first.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        let firstSettled = false;
        const firstCall = (async () => {
          await first.query("begin");
          try {
            const result = await add(first, "first");
            await first.query(
              `update ${schema}._private_jobs set locked_at = now(), locked_by = 'test_worker' where key = $1`,
              [jobKey],
            );
            await first.query("commit");
            return result;
          } catch (error) {
            await first.query("rollback");
            throw error;
          }
        })();
        firstCall.then(
          () => {
            firstSettled = true;
          },
          () => {
            firstSettled = true;
          },
        );

        let firstReached = false;
        for (let attempt = 0; attempt < 200 && !firstSettled; attempt++) {
          const { rows } = await observer.query<{
            wait_event_type: string | null;
            wait_event: string | null;
          }>(
            "select wait_event_type, wait_event from pg_stat_activity where pid = $1",
            [firstPidRows[0].pid],
          );
          if (
            rows[0]?.wait_event_type === "Lock" &&
            rows[0].wait_event === "advisory"
          ) {
            firstReached = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        firstReached ||= firstSettled;
        if (!firstReached) {
          throw new Error("First add_job did not finish or block on the key");
        }
        await gate.query("select pg_advisory_unlock($1, $2)", barrierKey);

        const [firstResult, secondResult] = await Promise.all([
          firstCall,
          secondCall,
        ]);
        expect(firstResult.rows[0].id).not.toBeNull();
        expect(secondResult.rows[0].id).not.toBeNull();
        const jobs = await getJobs(observer);
        expect(jobs.filter((job) => job.key === jobKey)).toHaveLength(1);
      } finally {
        await gate.query("select pg_advisory_unlock_all()");
        await Promise.all([gate.end(), first.end(), second.end()]);
      }
    }),
  20_000,
);
