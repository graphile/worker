import { CleanupOptions, CleanupTask } from "./interfaces";
import { CompiledOptions } from "./lib";

const ALL_CLEANUP_TASKS: CleanupTask[] = [
  "GC_TASK_IDENTIFIERS",
  "GC_JOB_QUEUES",
  "DELETE_PERMAFAILED_JOBS",
];

export function assertCleanupTasks(
  tasks: string[],
): asserts tasks is CleanupTask[] {
  const invalid = tasks.filter(
    (t) => !(ALL_CLEANUP_TASKS as string[]).includes(t),
  );
  if (invalid.length > 0) {
    throw new Error(
      `Invalid cleanup tasks; allowed values: '${ALL_CLEANUP_TASKS.join(
        "', '",
      )}'; you provided: '${tasks.join("', '")}'`,
    );
  }
}

export async function cleanup(
  compiledOptions: CompiledOptions,
  options: CleanupOptions,
) {
  const {
    tasks = ["GC_JOB_QUEUES", "GC_TASK_IDENTIFIERS"],
    taskIdentifiersToKeep = [],
  } = options;
  const { withPgClient, escapedWorkerSchema } = compiledOptions;
  await withPgClient(async (client) => {
    if (tasks.includes("DELETE_PERMAFAILED_JOBS")) {
      await client.query(
        `\
delete from ${escapedWorkerSchema}._private_jobs jobs
where attempts = max_attempts
and locked_at is null;`,
      );
    }
    if (tasks.includes("GC_TASK_IDENTIFIERS")) {
      await client.query(
        `\
delete from ${escapedWorkerSchema}._private_tasks tasks
where tasks.id not in (
  select jobs.task_id
  from ${escapedWorkerSchema}._private_jobs jobs
)
and tasks.identifier <> all ($1::text[]);`,
        [taskIdentifiersToKeep],
      );
    }
    if (tasks.includes("GC_JOB_QUEUES")) {
      await client.query(
        `\
delete from ${escapedWorkerSchema}._private_job_queues job_queues
where locked_at is null and id not in (
  select job_queue_id
  from ${escapedWorkerSchema}._private_jobs jobs
  where job_queue_id is not null
);`,
      );
    }
  });
}
