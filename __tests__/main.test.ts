import { migrate } from "../src/migrate";
import { withPgClient } from "./helpers";
import { TaskList, Task } from "../src/interfaces";
import { runAllJobs } from "../src/main";

test("runs jobs", () =>
  withPgClient(async pgClient => {
    await migrate(pgClient);
    await pgClient.query(`select graphile_worker.add_job('job1', '{"a": 1}')`);
    const job1: Task = jest.fn(o => {
      expect(o).toMatchInlineSnapshot(`
Object {
  "a": 1,
}
`);
    });
    const job2: Task = jest.fn();
    const tasks: TaskList = {
      job1,
      job2
    };
    await runAllJobs(tasks, pgClient);
    expect(job1).toHaveBeenCalledTimes(1);
    expect(job2).not.toHaveBeenCalled();
  }));
