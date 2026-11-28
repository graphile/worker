import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";

import type { EnhancedWithPgClient } from "../src/interfaces.ts";
import type { CompiledSharedOptions } from "../src/lib.ts";
import { getTaskDetails } from "../src/taskIdentifiers.ts";

// Lets the test force a garbage collection without needing `--expose-gc`
setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const tasks = { task1: async () => {} };

function makeWithPgClient() {
  const counter = { queries: 0 };
  const withPgClient = {
    withRetries: async (cb: (client: unknown) => Promise<unknown>) =>
      cb({
        query: async () => {
          counter.queries++;
          return { rows: [{ id: 1, identifier: "task1" }] };
        },
      }),
  } as unknown as EnhancedWithPgClient;
  return { withPgClient, counter };
}

function makeOptions() {
  return {
    escapedWorkerSchema: '"graphile_worker"',
  } as unknown as CompiledSharedOptions;
}

test("getTaskDetails caches the task identifiers for the same options", async () => {
  const { withPgClient, counter } = makeWithPgClient();
  const options = makeOptions();

  const first = await getTaskDetails(options, withPgClient, tasks);
  const queriesAfterFirst = counter.queries;
  const second = await getTaskDetails(options, withPgClient, tasks);

  expect(first.taskIds).toEqual([1]);
  expect(second).toBe(first);
  expect(counter.queries).toBe(queriesAfterFirst);
});

test("getTaskDetails does not keep options alive once they are released", async () => {
  let collected = false;
  const registry = new FinalizationRegistry<string>(() => {
    collected = true;
  });

  // Keep the only reference to `options` inside this function's scope
  await (async () => {
    const { withPgClient } = makeWithPgClient();
    const options = makeOptions();
    registry.register(options, "options");
    await getTaskDetails(options, withPgClient, tasks);
  })();

  for (let attempt = 0; attempt < 20 && !collected; attempt++) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  expect(collected).toBe(true);
});
