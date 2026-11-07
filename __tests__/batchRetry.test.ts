import { run } from "../src/index.ts";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  reset,
  sleep,
  withOptions,
} from "./helpers.ts";

/**
 * Regression test for https://github.com/graphile/worker/issues/636
 *
 * `batch()` wraps batched completions/failures in a retry loop governed by
 * `BATCH_RETRY_OPTIONS` (20 attempts, with shorter delays for retryable codes
 * such as `40P01` deadlock_detected). Previously the loop's `catch` ended with
 * `break`, so it bailed out after the very first failure and threw - none of
 * the retry code ran. A single transient error (deadlock / serialization
 * failure / dropped connection) therefore tore the worker pool down and left
 * the batched jobs locked, so they were re-executed later (duplicate
 * execution).
 *
 * Here we make the first batched completion fail with `40P01` and let later
 * attempts succeed; the job should be completed by a retry and the runner
 * should keep running.
 */
test("a batched completion that hits a transient deadlock is retried", () =>
  withOptions(async (options) => {
    const { pgPool } = options;
    await reset(pgPool, options);

    // Fail the *first* DELETE from `_private_jobs` (the batched completion) with
    // a deadlock_detected (`40P01`) error; every later attempt succeeds.
    await pgPool.query(`
      create sequence public.completion_attempts;
      create or replace function public.deadlock_once() returns trigger
      language plpgsql as $$
      begin
        if nextval('public.completion_attempts') = 1 then
          raise exception 'simulated deadlock' using errcode = '40P01';
        end if;
        return old;
      end;
      $$;
      create trigger deadlock_once
        before delete on ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs
        for each row execute function public.deadlock_once();
    `);

    const runner = await run({
      ...options,
      taskList: { job1: async () => {} },
      preset: { worker: { completeJobBatchDelay: 0 } },
    });
    let settled = false;
    runner.promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    try {
      await runner.addJob("job1", { id: "1" });
      let remaining = 1;
      for (let i = 0; i < 50 && remaining > 0; i++) {
        await sleep(100);
        remaining = (
          await pgPool.query(
            `select count(*)::int as n from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs`,
          )
        ).rows[0].n;
      }
      // The completion was retried after the deadlock, so the job is gone and
      // the runner is still alive (it did NOT tear the pool down).
      expect({ remaining, runnerStopped: settled }).toEqual({
        remaining: 0,
        runnerStopped: false,
      });
      // Guard against the test silently becoming a no-op: assert the trigger
      // actually fired more than once, i.e. the completion was re-attempted
      // after the simulated deadlock. Without the retry fix this would be 1
      // (single attempt) and the job would still be present above.
      const attempts = (
        await pgPool.query(
          `select last_value::int as n from public.completion_attempts`,
        )
      ).rows[0].n;
      expect(attempts).toBeGreaterThanOrEqual(2);
    } finally {
      await runner.stop().catch(() => {});
    }
  }));

/**
 * The retry loop must only retry *transient* errors. A non-retryable error
 * (here a plain `raise exception`, SQLSTATE P0001, which is not in
 * `RETRYABLE_ERROR_CODES`) can never succeed, so `batch()` must fail fast -
 * one attempt, then throw - rather than looping `BATCH_RETRY_OPTIONS.maxAttempts`
 * (20) times with backoff, which would delay the fatal shutdown by minutes.
 */
test("a batched completion that hits a non-retryable error fails fast (no retry)", () =>
  withOptions(async (options) => {
    const { pgPool } = options;
    await reset(pgPool, options);

    // Every DELETE from `_private_jobs` (the batched completion) raises a
    // non-retryable error, and each attempt is counted.
    await pgPool.query(`
      create sequence public.nonretryable_attempts;
      create or replace function public.fail_permanently() returns trigger
      language plpgsql as $$
      begin
        perform nextval('public.nonretryable_attempts');
        raise exception 'permanent failure';
        return old;
      end;
      $$;
      create trigger fail_permanently
        before delete on ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs
        for each row execute function public.fail_permanently();
    `);

    const runner = await run({
      ...options,
      taskList: { job1: async () => {} },
      preset: { worker: { completeJobBatchDelay: 0 } },
    });
    let settled = false;
    runner.promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    try {
      await runner.addJob("job1", { id: "1" });
      // The completion can never succeed, so the runner should tear down
      // quickly (fail fast), not after 20 backoff attempts.
      for (let i = 0; i < 50 && !settled; i++) {
        await sleep(100);
      }
      const attempts = (
        await pgPool.query(
          `select last_value::int as n, is_called from public.nonretryable_attempts`,
        )
      ).rows[0];
      const remaining = (
        await pgPool.query(
          `select count(*)::int as n from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}._private_jobs`,
        )
      ).rows[0].n;
      // Failed fast: the runner stopped, the job is still present (completion
      // never succeeded), and the completion was attempted exactly once - the
      // non-retryable error was NOT retried.
      expect({
        runnerStopped: settled,
        remaining,
        attempts: attempts.is_called ? attempts.n : 0,
      }).toEqual({ runnerStopped: true, remaining: 1, attempts: 1 });
    } finally {
      await runner.stop().catch(() => {});
    }
  }));
