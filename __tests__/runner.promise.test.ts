import { run } from "../src/index.ts";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  reset,
  withOptions,
} from "./helpers.ts";

// https://github.com/graphile/worker/issues/635
test("runner.promise rejects when the worker pool exits with an error", () =>
  withOptions(async (options) => {
    const { pgPool } = options;
    await reset(pgPool, options);
    await pgPool.query(`
      create or replace function public.refuse_job_completion() returns trigger
      language plpgsql as $$ begin raise exception 'completion refused'; end; $$;
      create trigger refuse_job_completion
        before delete on ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs
        for each row execute function public.refuse_job_completion();
    `);
    try {
      const runner = await run({
        ...options,
        taskList: { job1: async () => {} },
        preset: { worker: { completeJobBatchDelay: 0 } },
      });
      try {
        await runner.addJob("job1", { id: "1" });
        const outcome = await runner.promise.then(
          () => "resolved",
          (error: unknown) => `rejected: ${String(error)}`,
        );
        expect(outcome).toMatch(/^rejected: .*completion refused/);
      } finally {
        await runner.stop().catch(() => {});
      }
    } finally {
      await pgPool.query(`
        drop trigger if exists refuse_job_completion on ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs;
        drop function if exists public.refuse_job_completion();
      `);
    }
  }));

test("runner.promise still resolves after runner.stop()", () =>
  withOptions(async (options) => {
    await reset(options.pgPool, options);
    const runner = await run({
      ...options,
      taskList: { job1: async () => {} },
    });
    await runner.stop();
    await expect(runner.promise).resolves.toBeUndefined();
  }));
