import { Task, TaskList, WorkerSharedOptions } from "../src/interfaces";
import { runTaskListOnce } from "../src/main";
import {
  ESCAPED_GRAPHILE_WORKER_SCHEMA,
  getJobQueues,
  getJobs,
  reset,
  withPgClient,
} from "./helpers";

const options: WorkerSharedOptions = {};

test("batches jobs up in DB", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 1}]', job_key := 'mykey')`,
    );
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 2}]', job_key := 'mykey')`,
    );
    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 3}]', job_key := 'mykey')`,
    );

    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.task_identifier).toEqual("job3");
    expect(job.payload).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(job.attempts).toEqual(0);

    const jobQueues = await getJobQueues(pgClient);
    expect(jobQueues).toHaveLength(0);
  }));

test("on success, deletes job", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 1}, {"a": 2}, {"a": 3}]', job_key := 'mykey')`,
    );

    const job3: Task = jest.fn((o) => {
      expect(o).toMatchInlineSnapshot(`
        Array [
          Object {
            "a": 1,
          },
          Object {
            "a": 2,
          },
          Object {
            "a": 3,
          },
        ]
      `);
    });
    const job4: Task = jest.fn();
    const tasks: TaskList = {
      job3,
      job4,
    };
    await runTaskListOnce(options, tasks, pgClient);

    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(0);

    const jobQueues = await getJobQueues(pgClient);
    expect(jobQueues).toHaveLength(0);
  }));

test("on failure, re-enqueues job", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 1}, {"a": 2}, {"a": 3}]', job_key := 'mykey')`,
    );

    const job3: Task = jest.fn(() => {
      throw new Error("RETRY");
    });
    const job4: Task = jest.fn();
    const tasks: TaskList = {
      job3,
      job4,
    };
    await runTaskListOnce(options, tasks, pgClient);

    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.task_identifier).toEqual("job3");
    expect(job.payload).toHaveLength(3);
    expect(job.payload).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
    expect(job.attempts).toEqual(1);

    const jobQueues = await getJobQueues(pgClient);
    expect(jobQueues).toHaveLength(0);
  }));

test("on partial fail, re-enqueues job with just failed elements", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 1}, {"a": 2}, {"a": 3}]', job_key := 'mykey')`,
    );

    const job3: Task = jest.fn((o) => {
      return (o as Array<{ a: number }>).map(({ a }) =>
        a % 2 === 1 ? Promise.reject(new Error(String(a))) : null,
      );
    });
    const job4: Task = jest.fn();
    const tasks: TaskList = {
      job3,
      job4,
    };
    await runTaskListOnce(options, tasks, pgClient);

    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.task_identifier).toEqual("job3");
    expect(job.payload).toHaveLength(2);
    expect(job.payload).toEqual([{ a: 1 }, { a: 3 }]);
    expect(job.attempts).toEqual(1);

    const jobQueues = await getJobQueues(pgClient);
    expect(jobQueues).toHaveLength(0);
  }));

test("on partial fail (promise), re-enqueues job with just failed elements", () =>
  withPgClient(async (pgClient) => {
    await reset(pgClient, options);

    await pgClient.query(
      `select * from ${ESCAPED_GRAPHILE_WORKER_SCHEMA}.add_job('job3', '[{"a": 1}, {"a": 2}, {"a": 3}]', job_key := 'mykey')`,
    );

    const job3: Task = jest.fn(async (o) => {
      return (o as Array<{ a: number }>).map(({ a }) =>
        a % 2 === 1 ? Promise.reject(new Error(String(a))) : null,
      );
    });
    const job4: Task = jest.fn();
    const tasks: TaskList = {
      job3,
      job4,
    };
    await runTaskListOnce(options, tasks, pgClient);

    const jobs = await getJobs(pgClient);
    expect(jobs).toHaveLength(1);
    const job = jobs[0];
    expect(job.task_identifier).toEqual("job3");
    expect(job.payload).toHaveLength(2);
    expect(job.payload).toEqual([{ a: 1 }, { a: 3 }]);
    expect(job.attempts).toEqual(1);

    const jobQueues = await getJobQueues(pgClient);
    expect(jobQueues).toHaveLength(0);
  }));
