import type { EnhancedWithPgClient, TaskList } from "../src/interfaces.ts";
import type { CompiledSharedOptions } from "../src/lib.ts";
import { getTaskDetails } from "../src/taskIdentifiers.ts";

const compiled = {
  escapedWorkerSchema: "graphile_worker",
} as unknown as CompiledSharedOptions;

const tasks: TaskList = {
  send_email: () => undefined,
};

test("caches task details per compiled options", async () => {
  let calls = 0;
  const withPgClient = {
    withRetries: async () => {
      calls += 1;
      return { rows: [{ id: 7, identifier: "send_email" }] };
    },
  } as unknown as EnhancedWithPgClient;

  const first = await getTaskDetails(compiled, withPgClient, tasks);
  const second = await getTaskDetails(compiled, withPgClient, tasks);

  expect(second).toBe(first);
  expect(calls).toBe(1);

  const otherCompiled = {
    escapedWorkerSchema: "graphile_worker",
  } as unknown as CompiledSharedOptions;
  const other = await getTaskDetails(otherCompiled, withPgClient, tasks);

  expect(other).not.toBe(first);
  expect(calls).toBe(2);
});
