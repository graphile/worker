import * as FakeTimers from "@sinonjs/fake-timers";

import { run } from "../src";
import { WorkerSharedOptions } from "../src/interfaces";
import { reset, withPgPool } from "./helpers";

const options: WorkerSharedOptions = {
  useNodeTime: true,
};
let clock: FakeTimers.Clock;
beforeEach(() => {
  // Can't use jest.useFakeTimers() because it doesn't fake Date
  // https://github.com/facebook/jest/issues/2684
  clock = FakeTimers.install();
});

afterEach(() => {
  clock.uninstall();
});

test("mock node time", () =>
  withPgPool(async (pgPool) => {
    await reset(pgPool, options);

    const job1 = jest.fn();
    const job2 = jest.fn();
    const runner = await run({
      useNodeTime: true,
      pollInterval: 1000,
      pgPool,
      taskList: { job1, job2 },
      crontab: "* * * * * job2",
    });
    const future = new Date();
    future.setMilliseconds(future.getMilliseconds() + 1000);
    await runner.addJob("job1", undefined, { runAt: future });
    clock.tick(1001);
    await new Promise((resolve) => {
      runner.events.on("job:complete", resolve);
    });
    await new Promise((resolve) => {
      runner.events.on("job:complete", resolve);
    });
    await runner.stop();
    expect(job1).toHaveBeenCalledTimes(1);
    expect(job2).toHaveBeenCalledTimes(1);
  }));
