---
title: "Local queue"
sidebar_position: 121
---

By default, each worker in a pool asks the database for its next job when it
becomes free. The local queue changes that: the pool fetches (and locks) a batch
of jobs up front and hands them out to its workers as they become available, so
a worker can start its next job without a roundtrip to the database.

The local queue is **disabled by default**. It's worth enabling when you have
high throughput and fairly quick tasks; see [Performance](/docs/performance) for
benchmarks and a recommended starting configuration.

## Enabling the local queue

```ts title="graphile.config.ts"
const preset: GraphileConfig.Preset = {
  worker: {
    concurrentJobs: 24,
    localQueue: {
      size: 25,
    },
  },
};
```

Setting `localQueue.size` to `1` or more enables the local queue; `-1` (the
default) disables it.

## Options

All options live under `preset.worker.localQueue`.

### `size`

Type: `number`, default: `-1` (disabled)

The maximum number of jobs the pool will fetch and lock in one go. Each time the
local queue runs out of jobs it fetches up to `size` more.

A good starting point is `concurrentJobs + 1`, which means the next job is
usually already waiting when a task completes. Very high throughput, very fast
tasks may benefit from a larger value; slow tasks or low throughput may be
better served by a small value (even `2` helps) or by leaving the local queue
disabled.

If `size` is smaller than `concurrentJobs`, Worker logs a warning, since your
workers may end up waiting on the database more often than without the local
queue.

### `ttl`

Type: `number` (milliseconds), default: `300000` (5 minutes)

How long fetched jobs may sit in the local queue without being claimed by a
worker. When this expires, any unclaimed jobs are unlocked and returned to the
database so other Worker instances can run them. The local queue then stays idle
until one of its workers asks for a job, at which point it fetches again.

### `refetchDelay`

Type: `{ durationMs: number; threshold?: number; maxAbortThreshold?: number }`,
default: not set (no refetch delay)

At larger scale (several Worker instances, each with some concurrency) there are
often too few jobs to keep every pool busy. Each new job then triggers a "new
job" notification to every pool, and every pool queries the database for it.
`refetchDelay` reduces this load: when a fetch returns too few jobs, the pool
waits a while before fetching again, mostly ignoring "new job" notifications in
the meantime.

- **`durationMs`** (required): roughly how long to wait before fetching again.
  The actual delay is randomized between `0.5 × durationMs` and
  `1.5 × durationMs` so that pools don't all poll at the same moment. Must not
  be larger than `preset.worker.pollInterval`, otherwise Worker will throw on
  startup. While workers are mostly idle and jobs trickle in, expect around
  `(1000 / durationMs) × INSTANCE_COUNT` fetch queries per second.
- **`threshold`** (default: `0`): the delay starts when a fetch returns this
  many jobs **or fewer** (and fewer than `size`). With the default, only an
  empty fetch triggers it.
- **`maxAbortThreshold`** (default: `5 × size`): while delayed, the pool counts
  "new job" notifications and fetches early once it has received a random number
  of them between `0` and `maxAbortThreshold`. The randomness means pools abort
  at different times, which avoids a thundering herd while still keeping latency
  down. Set it to `Infinity` to always wait the full delay. If you're not sure,
  start with `size` multiplied by the number of Worker instances you run, and
  adjust from there.

## Tradeoffs

The local queue trades some latency and fairness for throughput and lower
database load:

- **More jobs are locked than are being worked on.** Jobs are locked as soon as
  they enter a local queue, so no other instance can take them, even if they
  then wait for up to `ttl`.
- **Jobs can wait while another instance is idle.** If one instance's local
  queue holds jobs while another instance has nothing to do, those jobs won't
  move until the first instance gets to them or `ttl` expires.
- **New high-priority jobs aren't seen straight away.** While the local queue
  still holds jobs it ignores "new job" notifications, so a newly added job
  (even with a higher priority) is only picked up on the next fetch.
- **Crashes leave more jobs locked.** If a worker doesn't exit gracefully (e.g.
  it crashes or is killed), every job in its local queue stays locked until the
  4 hour lock timeout expires. Graphile Worker Pro can recover these sooner.

If your tasks are slow (tens of seconds or more), your throughput is low, or you
need high priority jobs to start as soon as possible, use a small `size` or
leave the local queue disabled. `completeJobBatchDelay` and `failJobBatchDelay`
can still be used either way.

## Observing the local queue

The local queue emits [worker events](/docs/worker-events) you can use to
monitor it, for example `localQueue:setMode`, `localQueue:getJobs:complete`,
`localQueue:returnJobs` and the `localQueue:refetchDelay:*` events.
