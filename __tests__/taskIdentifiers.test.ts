import { jest } from "@jest/globals";

import defer from "../src/deferred.ts";
import type { EnhancedWithPgClient } from "../src/interfaces.ts";
import type { CompiledSharedOptions } from "../src/lib.ts";
import { getTaskDetails } from "../src/taskIdentifiers.ts";

function setup() {
  const options = {
    escapedWorkerSchema: '"graphile_worker"',
  } as CompiledSharedOptions;
  // Control completion at the database boundary, after connection retries.
  const withRetries = jest.fn<EnhancedWithPgClient["withRetries"]>();
  const withPgClient = { withRetries } as unknown as EnhancedWithPgClient;
  return {
    withRetries,
    lookup: (name = "task") =>
      getTaskDetails(options, withPgClient, { [name]: async () => {} }),
  };
}

const result = (id: number, identifier = "task") => ({
  rows: [{ id, identifier }],
});

test.each(["53300", "ECONNRESET"])(
  "retries a failed task lookup (%s) and caches the successful result",
  async (code) => {
    const { withRetries, lookup } = setup();
    const error = Object.assign(new Error("database unavailable"), { code });
    withRetries.mockRejectedValueOnce(error).mockResolvedValueOnce(result(1));

    await expect(lookup()).rejects.toBe(error);
    const details = await lookup();
    expect(details.taskIds).toEqual([1]);
    expect(lookup()).toBe(details);
    expect(withRetries).toHaveBeenCalledTimes(2);
  },
);

test("concurrent callers share a pending lookup and its retry", async () => {
  const { withRetries, lookup } = setup();
  const pending = defer();
  withRetries.mockReturnValueOnce(pending).mockResolvedValueOnce(result(1));
  const first = lookup();
  expect(lookup()).toBe(first);
  const rejected = expect(first).rejects.toThrow("unavailable");
  pending.reject(new Error("unavailable"));
  await rejected;

  const retry = lookup();
  expect(lookup()).toBe(retry);
  await expect(retry).resolves.toMatchObject({ taskIds: [1] });
  expect(withRetries).toHaveBeenCalledTimes(2);
});

test.each(["success", "failure"])(
  "a stale lookup's %s does not replace a newer task list",
  async (outcome) => {
    const { withRetries, lookup } = setup();
    const pending = defer<ReturnType<typeof result>>();
    withRetries
      .mockReturnValueOnce(pending)
      .mockResolvedValue(result(2, "new"));
    const first = lookup("old");
    const current = await lookup("new");

    if (outcome === "failure") {
      const rejected = expect(first).rejects.toThrow("unavailable");
      pending.reject(new Error("unavailable"));
      await rejected;
    } else {
      pending.resolve(result(1, "old"));
      await expect(first).resolves.toMatchObject({ taskIds: [1] });
    }

    expect(lookup("new")).toBe(current);
    expect(current.taskIds).toEqual([2]);
    expect(withRetries).toHaveBeenCalledTimes(2);
  },
);
