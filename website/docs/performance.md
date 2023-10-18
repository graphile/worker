---
title: "Performance"
sidebar_position: 120
---

`graphile-worker` is not intended to replace extremely high performance
dedicated job queues, it's intended to be a very easy way to get a reasonably
performant job queue up and running with Node.js and PostgreSQL. But this
doesn't mean it's a slouch by any means - it achieves an average latency from
triggering a job in one process to executing it in another of under 3ms, and a
12-core database server can queue around 99,600 jobs per second and can process
around 11,800 jobs per second.

`graphile-worker` is horizontally scalable to a point. Each instance has a
customisable worker pool, this pool defaults to size 1 (only one job at a time
on this worker) but depending on the nature of your tasks (i.e. assuming they're
not compute-heavy) you will likely want to set this higher to benefit from
Node.js' concurrency. If your tasks are compute heavy you may still wish to set
it higher and then using Node's `child_process` (or Node v11's `worker_threads`)
to share the compute load over multiple cores without significantly impacting
the main worker's runloop. Note, however, that Graphile Worker is limited by the
performance of the underlying Postgres database, and when you hit this limit
performance will start to go down (rather than up) as you add more workers.

To test performance, you can run `yarn perfTest`. This runs three tests:

1. a startup/shutdown test to see how fast the worker can startup and exit if
   there's no jobs queued (this includes connecting to the database and ensuring
   the migrations are up to date)
2. a load test - by default this will run 20,000
   [trivial](https://github.com/graphile/worker/blob/main/perfTest/tasks/log_if_999.js)
   jobs with a parallelism of 4 (i.e. 4 node processes) and a concurrency of 10
   (i.e. 10 concurrent jobs running on each node process), but you can configure
   this in `perfTest/run.js`. (These settings were optimised for a 12-core
   hyperthreading machine running both the tests and the database locally.)
3. a latency test - determining how long between issuing an `add_job` command
   and the task itself being executed.

## perfTest results:

The test was ran on a 12-core AMD Ryzen 3900 with an M.2 SSD, running both the
workers and the database (and a tonne of Chrome tabs, electron apps, and what
not). Jobs=20000, parallelism=4, concurrency=10.

Conclusion:

- Startup/shutdown: 110ms
- Jobs per second: 11,851
- Average latency: 2.66ms (min: 2.39ms, max: 12.09ms)

```
Timing startup/shutdown time...
... it took 110ms

Scheduling 20000 jobs
Adding jobs: 200.84ms
... it took 287ms


Timing 20000 job execution...
Found 999!

... it took 1797ms
Jobs per second: 11851.90


Testing latency...
[core] INFO: Worker connected and looking for jobs... (task names: 'latency')
Beginning latency test
Latencies - min: 2.39ms, max: 12.09ms, avg: 2.66ms
```

TODO: post perfTest results in a more reasonable configuration, e.g. using an
RDS PostgreSQL server and a worker running on EC2.
