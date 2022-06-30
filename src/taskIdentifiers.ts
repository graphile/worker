import * as assert from "assert";

import { TaskList, WithPgClient } from "./interfaces";
import { CompiledSharedOptions } from "./lib";

export interface SupportedTaskIdentifierByTaskId {
  [id: number]: string;
}

interface TaskDetails {
  supportedTaskIdentifiersByTaskId: SupportedTaskIdentifierByTaskId;
  taskIds: number[];
}

let lastStr: string | Promise<string> = "";
let lastDigest: TaskDetails | Promise<TaskDetails> = {
  supportedTaskIdentifiersByTaskId: {},
  taskIds: [],
};
export function getTaskDetails(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  tasks: TaskList,
): TaskDetails | Promise<TaskDetails> {
  const supportedTaskNames = Object.keys(tasks);
  const str = JSON.stringify(supportedTaskNames);
  if (str !== lastStr) {
    const { escapedWorkerSchema } = compiledSharedOptions;
    assert(supportedTaskNames.length, "No runnable tasks!");
    lastStr = str;
    lastDigest = (async () => {
      const { rows } = await withPgClient(async (client) => {
        await client.query({
          text: `insert into ${escapedWorkerSchema}.tasks (identifier) select unnest($1::text[]) on conflict do nothing`,
          values: [supportedTaskNames],
        });
        return client.query<{ id: number; identifier: string }>({
          text: `select id, identifier from ${escapedWorkerSchema}.tasks where identifier = any($1::text[])`,
          values: [supportedTaskNames],
        });
      });

      const supportedTaskIdentifiersByTaskId = Object.create(null);
      for (const row of rows) {
        supportedTaskIdentifiersByTaskId[row.id] = row.identifier;
      }

      const taskIds = Object.keys(supportedTaskIdentifiersByTaskId).map((s) =>
        parseInt(s, 10),
      );

      // Overwrite promises with concrete values
      lastDigest = {
        supportedTaskIdentifiersByTaskId,
        taskIds,
      };
      lastStr = str;
      return lastDigest;
    })();
  }
  return lastDigest;
}

export function getSupportedTaskIdentifierByTaskId(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  tasks: TaskList,
): SupportedTaskIdentifierByTaskId | Promise<SupportedTaskIdentifierByTaskId> {
  const p = getTaskDetails(compiledSharedOptions, withPgClient, tasks);
  if ("supportedTaskIdentifiersByTaskId" in p) {
    return p.supportedTaskIdentifiersByTaskId;
  } else {
    return p.then((o) => o.supportedTaskIdentifiersByTaskId);
  }
}

export function getSupportedTaskIds(
  compiledSharedOptions: CompiledSharedOptions,
  withPgClient: WithPgClient,
  tasks: TaskList,
): number[] | Promise<number[]> {
  const p = getTaskDetails(compiledSharedOptions, withPgClient, tasks);
  if ("taskIds" in p) {
    return p.taskIds;
  } else {
    return p.then((o) => o.taskIds);
  }
}
