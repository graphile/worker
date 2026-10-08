import type { EnhancedWithPgClient, TaskList } from "../src/interfaces.ts";
import type { CompiledSharedOptions } from "../src/lib.ts";
import { getTaskDetails } from "../src/taskIdentifiers.ts";

const tasks: TaskList = {
  send_email: () => undefined,
};

test("retries a task identifier lookup after the cached lookup rejects", async () => {
  let attempts = 0;
  const withPgClient = Object.assign(async () => undefined, {
    withRetries: async () => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error("admin shutdown");
        Object.assign(error, { code: "57P01" });
        throw error;
      }
      return { rows: [{ id: 7, identifier: "send_email" }] };
    },
  }) as EnhancedWithPgClient;
  const compiled = {
    escapedWorkerSchema: "graphile_worker",
  } as CompiledSharedOptions;

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
