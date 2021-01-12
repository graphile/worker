const { run, quickAddJob } = require(/* "graphile-worker" */ "../..");

async function main() {
  // Run a worker to execute jobs:
  const runner = await run({
    connectionString: "postgres:///my_db",
    concurrency: 5,
    // Install signal handlers for graceful shutdown on SIGINT, SIGTERM, etc
    noHandleSignals: false,
    pollInterval: 1000,
    // you can set the taskList or taskDirectory but not both
    taskList: {
      hello: async (payload, helpers) => {
        const { name } = payload;
        helpers.logger.info(`Hello, ${name}`);
      },
    },
    // or:
    //   taskDirectory: `${__dirname}/tasks`,
  });

  runner.events.on("job:success", ({ worker, job }) => {
    console.log(`Hooray! Worker ${worker.workerId} completed job ${job.id}`);
  });

  // Or add a job to be executed:
  await quickAddJob(
    // makeWorkerUtils options
    { connectionString: "postgres:///my_db" },

    // Task identifier
    "hello",

    // Payload
    { name: "Bobby Tables" },
  );

  // If the worker exits (whether through fatal error or otherwise), this
  // promise will resolve/reject:
  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
