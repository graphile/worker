import type { EnhancedWithPgClient, TaskList } from "../src/interfaces.ts";
import type { CompiledSharedOptions } from "../src/lib.ts";
import { getTaskDetails } from "../src/taskIdentifiers.ts";

const compiled = {
  escapedWorkerSchema: "graphile_worker",
} as unknown as CompiledSharedOptions;

const tasks: TaskList = {
  send_email: () => undefined,
};

test("retries a task identifier lookup after the cached lookup rejects", async () => {
  let attempts = 0;
  const withPgClient = {
    withRetries: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("admin shutdown");
        Object.assign(error, { code: "57P01" });
        throw error;
      }
      return { rows: [{ id: 7, identifier: "send_email" }] };
    },
  } as unknown as EnhancedWithPgClient;

  await expect(getTaskDetails(compiled, withPgClient, tasks)).rejects.toThrow(
    "admin shutdown",
  );

  const details = await getTaskDetails(compiled, withPgClient, tasks);
  expect(attempts).toBe(2);
  expect(details.taskIds).toEqual([7]);
  expect(details.supportedTaskIdentifierByTaskId[7]).toBe("send_email");

  await getTaskDetails(compiled, withPgClient, tasks);
  expect(attempts).toBe(2);
});

test("does not clear a newer lookup when an older lookup rejects", async () => {
  const otherCompiled = {
    escapedWorkerSchema: "graphile_worker",
  } as unknown as CompiledSharedOptions;
  const tasksA: TaskList = { task_a: () => undefined };
  const tasksB: TaskList = { task_b: () => undefined };

  let calls = 0;
  let rejectA!: (error: Error) => void;
  const aLookup = new Promise<never>((_resolve, reject) => {
    rejectA = reject;
  });
  const withPgClient = {
    withRetries: async () => {
      calls += 1;
      if (calls === 1) {
        return aLookup;
      }
      return { rows: [{ id: 8, identifier: "task_b" }] };
    },
  } as unknown as EnhancedWithPgClient;

  const aResult = getTaskDetails(otherCompiled, withPgClient, tasksA);
  const aRejects = expect(aResult).rejects.toThrow("admin shutdown");

  const bDetails = await getTaskDetails(otherCompiled, withPgClient, tasksB);
  expect(bDetails.taskIds).toEqual([8]);

  rejectA(new Error("admin shutdown"));
  await aRejects;

  const bAgain = await getTaskDetails(otherCompiled, withPgClient, tasksB);
  expect(calls).toBe(2);
  expect(bAgain.taskIds).toEqual([8]);
});
