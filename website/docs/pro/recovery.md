---
title: "Crashed worker recovery"
sidebar_position: 20
draft: true
---

If a regular Graphile Worker process exits unexpectedly (for example someone
pulls the power lead from the server, or the Node.js process crashes or is
killed) it does not have a chance to unlock its active jobs, and they remain
locked for up to 4 hours. For some jobs, not being attempted again for 4 hours
could be far too long.

Worker Pro tracks running workers via a &ldquo;heartbeat&rdquo;, and when a
worker has not checked in for a configurable amount of time we can assume that
this worker is no longer active (crashed, was terminated, server shut down, etc)
and release its jobs back to the pool to be executed (honouring
[exponential backoff](../exponential-backoff.md) to help avoid crashes from
poorly written task executors causing worker progress to stall).

:::note

Due to [CAP theorem](https://en.wikipedia.org/wiki/CAP_theorem) we cannot know
it&apos;s definitely safe to release jobs. In a standard production setup for
Graphile Worker, you&apos;ll have multiple (1 or more) workers, each worker may
be running on the same or different hardware, and they&apos;ll all be talking to
one primary PostgreSQL server which will most likely be running on different
hardware again.

It&apos;s possible for a worker to check out a job from the database and then
lose connection to the database. The worker can continue to process its work
(lets say doing a speech-to-text analysis of a long video) in the hopes the
database connection will be restored by the time it completes. If our
&ldquo;cleanup process&rdquo; runs before this happens then we might end up
accidentally releasing and re-attempting the job when the worker is still in
progress. This is why the default 4 hour timeout exists in Graphile Worker, but
in Pro we make it configurable for you &mdash; it&apos;s up to you to determine
how long you think a &ldquo;net split&rdquo; might persist between your worker
and database.

:::

## Configuration

See [Pro configuration](./config.md) for details on how to configure Worker Pro,
including the full meaning of each option.

The crash recovery feature relies on the following settings:

- `heartbeatInterval` &mdash; worker checkin frequency
- `sweepInterval` &mdash; inactive worker check frequency
- `sweepThreshold` &mdash; how long since the last heartbeat before a worker is
  deemed "inactive"

:::info

It might take anywhere from `sweepThreshold` to
`heartbeatInterval + sweepThreshold + sweepInterval` (plus processing time, etc)
milliseconds for jobs from a crashed worker to be released.

:::
