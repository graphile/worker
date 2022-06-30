import { EventEmitter } from "events";
import { Pool } from "pg";

import { run } from "../src";
import deferred, { Deferred } from "../src/deferred";
import { Task, TaskList, WorkerSharedOptions } from "../src/interfaces";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  jobCount,
  reset,
  sleep,
  sleepUntil,
  withPgPool,
} from "./helpers";

const EVENTS = [
  "pool:create",
  "pool:listen:connecting",
  "pool:listen:success",
  "pool:listen:error",
  "pool:release",
  "pool:gracefulShutdown",
  "pool:gracefulShutdown:error",
  "worker:create",
  "worker:release",
  "worker:stop",
  "worker:getJob:start",
  "worker:getJob:error",
  "worker:getJob:empty",
  "worker:fatalError",
  "job:start",
  "job:success",
  "job:error",
  "job:failed",
  "job:complete",
  "gracefulShutdown",
  "stop",
];

const addJob = (pgPool: Pool, id?: string | number) =>
  pgPool.query(
    `select ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job1', json_build_object('id', $1::text), 'serial')`,
    [String(id != null ? id : Math.random())],
  );

const options: WorkerSharedOptions = {};

test("emits the expected events", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    // Build the tasks
    const jobPromises: {
      [id: string]: Deferred | undefined;
    } = {};
    try {
      const job1: Task = jest.fn(({ id }: { id: string }) => {
        const jobPromise = deferred();
        if (jobPromises[id]) {
          throw new Error("Job with this id already registered");
        }
        jobPromises[id] = jobPromise;
        return jobPromise;
      });
      const tasks: TaskList = {
        job1,
      };

      // Run the worker
      const events = new EventEmitter();

      const emittedEvents: Array<{ event: string; payload: any }> = [];
      const createListener = (event: string) => {
        return (payload: any) => {
          emittedEvents.push({ event, payload });
        };
      };

      EVENTS.forEach((event) => {
        events.on(event, createListener(event));
      });

      const CONCURRENCY = 3;
      const runner = await run({
        concurrency: CONCURRENCY,
        pgPool,
        taskList: tasks,
        events,
      });

      expect(runner.events).toEqual(events);

      const eventCount = (name: string) =>
        emittedEvents.map((obj) => obj.event).filter((n) => n === name).length;

      // NOTE: these are the events that get emitted _before_ `run` resolves; so
      // you can only receive these if you pass an EventEmitter to run manually.
      expect(eventCount("pool:create")).toEqual(1);
      expect(eventCount("pool:listen:connecting")).toEqual(1);
      expect(eventCount("worker:create")).toEqual(CONCURRENCY);

      let finished = false;
      runner.promise.then(() => {
        finished = true;
      });

      for (let i = 0; i < 5; i++) {
        await addJob(pgPool, i);
      }

      for (let i = 0; i < 5; i++) {
        await sleepUntil(() => !!jobPromises[i]);
        expect(eventCount("job:start")).toEqual(i + 1);
        expect(eventCount("job:success")).toEqual(i);
        expect(eventCount("job:complete")).toEqual(i);
        jobPromises[i]!.resolve();
        await sleepUntil(() => eventCount("job:complete") === i + 1);
        expect(eventCount("job:success")).toEqual(i + 1);
      }

      await sleep(1);
      expect(finished).toBeFalsy();
      expect(eventCount("stop")).toEqual(0);
      expect(eventCount("worker:release")).toEqual(0);
      expect(eventCount("pool:release")).toEqual(0);
      await runner.stop();
      expect(eventCount("stop")).toEqual(1);
      expect(job1).toHaveBeenCalledTimes(5);
      await sleep(1);
      expect(finished).toBeTruthy();
      await runner.promise;
      expect(eventCount("worker:release")).toEqual(CONCURRENCY);
      expect(eventCount("worker:stop")).toEqual(CONCURRENCY);
      expect(eventCount("pool:release")).toEqual(1);
      expect(await jobCount(pgPool)).toEqual(0);
    } finally {
      if (jobPromises) {
        Object.values(jobPromises).forEach((p) => p?.resolve());
      }
    }
  }));
