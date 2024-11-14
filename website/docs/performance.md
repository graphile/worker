---
title: "Performance"
sidebar_position: 120
---

## Quick stats

Quick stats in optimial conditions:

- jobs executed per second: ~183,000
- average latency from add_job to job execution start: 4.16ms (max: 13.84ms)
- jobs queued per second from single add_jobs batch call: ~202,000
- time to start and immediately shut down the worker: 68ms

The above stats were achieved with this configuration:

```ts
const preset = {
  worker: {
    connectionString: "postgres:///graphile_worker_perftest",
    fileExtensions: [".js", ".cjs", ".mjs"],

    concurrentJobs: 24,
    maxPoolSize: 25,

    // Batching options (see below)
    localQueue: { size: 500 },
    completeJobBatchDelay: 0,
    failJobBatchDelay: 0,
  },
};
```

## Performance statement

`graphile-worker` is not intended to replace extremely high performance
dedicated job queues for Facebook scale, it&apos;s intended to give regular
organizations the fastest and easiest to set up job queue we can achieve without
needing to expand your infrastructure beyond Node.js and PostgreSQL. But this
doesn&apos;t mean it&apos;s a slouch by any means &mdash; it achieves an average
latency from triggering a job in one process to executing it in another of under
5ms, and a well-specced database server can queue around 172,000 jobs per second
from a single PostgreSQL client, and can process around 196k jobs per second
using a pool of 4 Graphile Worker instances, each with concurrency set to 24.
For many organizations, this is more than they'll ever need.

## Horizontal scaling

`graphile-worker` is horizontally scalable to a point. Each instance has a
customizable worker pool, this pool defaults to size 1 (only one job at a time
on this worker) but depending on the nature of your tasks (i.e. assuming
they&apos;re not compute-heavy) you will likely want to set this higher to
benefit from Node.js&apos; concurrency. If your tasks are compute heavy you may
still wish to set it higher and then using Node&apos;s `child_process` or
`worker_threads` to share the compute load over multiple cores without
significantly impacting the main worker&apos;s run loop.

## Enabling batching for highest performance

Graphile Worker is limited by the performance of the underlying Postgres
database, and when you hit this limit performance will start to go down (rather
than up) as you add more workers.

To mitigate this, we've added batching functionality to many of the internal
methods which you can enable via the configuration. For example using a local
queue enables each pool to pull down a configurable number of jobs up front so
its workers can start a new job the moment their previous one completes without
having to request a new job from the database. This batching also reduces load
on the database since there are fewer total queries per second, but it's a
slight trade-off since more jobs are checked out but not necessarily actively
being worked on, so latency may increase and in the event of a crash more jobs
will be locked.

## Running the performance tests

To test performance, you can check out the repository and then run
`yarn perfTest`. This runs three tests:

1. a startup/shutdown test to see how fast the worker can startup and exit if
   there&apos;s no jobs queued (this includes connecting to the database and
   ensuring the migrations are up to date)
2. a load test &mdash; by default this will run 200,000
   [trivial](https://github.com/graphile/worker/blob/main/perfTest/tasks/log_if_999.js)
   jobs with a parallelism of 4 (i.e. 4 node processes) and a concurrency of 24
   (i.e. 24 concurrent jobs running on each node process), but you can configure
   this in `perfTest/run.js`. (These settings were optimized for a Intel
   i9-14900K with efficiency cores disabled and running both the tests and the
   database locally.)
3. a latency test &mdash; determining how long between issuing an `add_job`
   command and the task itself being executed.

## perfTest results:

Executed on
[this machine](https://uk.pcpartpicker.com/user/BenjieGillam/saved/#view=BjtCrH),
running both the workers and the database (and a tonne of Chrome tabs, electron
apps, and what not).

### With batching

**Jobs per second: ~184,000**

```ts
const preset = {
  worker: {
    connectionString: "postgres:///graphile_worker_perftest",
    fileExtensions: [".js", ".cjs", ".mjs"],

    concurrentJobs: 24,
    maxPoolSize: 25,

    // Batching options (see below)
    localQueue: { size: 500 },
    completeJobBatchDelay: 0,
    failJobBatchDelay: 0,
  },
};
```

```
Timing startup/shutdown time...
... it took 68ms

Scheduling 200000 jobs
Adding jobs: 988.425ms
... it took 1160ms


Timing 200000 job execution...
Found 999!

... it took 1156ms
Jobs per second: 183895.49

Testing latency...
[core] INFO: Worker connected and looking for jobs... (task names: 'latency')
Beginning latency test
Latencies - min: 3.24ms, max: 18.18ms, avg: 4.28ms
```

### Without batching

**Jobs per second: ~15,600**

```ts
const preset = {
  worker: {
    connectionString: "postgres:///graphile_worker_perftest",
    fileExtensions: [".js", ".cjs", ".mjs"],

    concurrentJobs: 24,
    maxPoolSize: 25,

    // Batching disabled (default)
    localQueue: { size: -1 },
    completeJobBatchDelay: -1,
    failJobBatchDelay: -1,
  },
};
```

```
Timing startup/shutdown time...
... it took 77ms


Scheduling 200000 jobs
Adding jobs: 992.368ms
... it took 1163ms


Timing 200000 job execution...
Found 999!

... it took 12892ms
Jobs per second: 15606.79


Testing latency...
[core] INFO: Worker connected and looking for jobs... (task names: 'latency')
Beginning latency test
Latencies - min: 3.40ms, max: 14.13ms, avg: 4.47ms
```

TODO: post perfTest results in a more reasonable configuration, e.g. using an
RDS PostgreSQL server and a worker running on EC2.
