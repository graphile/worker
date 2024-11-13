---
title: Techniques
---

This page outlines some of the techniques that may not be obvious but allow you
to extract more power from Graphile Worker.

## Limiting concurrency

Out of the box, Graphile Worker supports jobs being added to a named queue (in
which case that queue has a concurrency of 1) or not being added to a queue (in
which case the jobs can execute as quickly as there are workers to execute
them). Sometimes you want to limit concurrency to a small number, but larger
than 1... Here are some techniques you can use to do this.

### Dedicated worker with specific concurrency

With this technique, you'd make sure that only one worker supports this task
identifier (and that worker supports this task identifier only), and then you
run this worker with the desired concurrency and make sure not to add the jobs
to a named queue.

This is effective, but it requires running a separate worker which may spend a
lot of time idle.

A variant of this technique is to run N dedicated workers each with concurrency
M, where N\*M is your desired concurrency.

### Multiple queue names

Whether via round-robin, random, or some other method; this technique has you
create as many named queues as you need concurrency and schedule tasks into
these queues.

One trade-off of this approach is that jobs may not be ran in the desired
order - order is only maintained within each named queue, but if jobs in one
named queue execute faster or slower than others, the tasks may come out of
sync.

### Forbidden flags

[Read more here](/docs/forbidden-flags).

## Managing priority

So you've got some new jobs that need to execute _right now_, but your workers
are all busy executing long-running boring background tasks already? Here's some
solutions!

### Dedicated high-priority worker

Assuming that your high priority tasks belong to their own task identifier, you
can run a separate worker that's dedicated to this task identifier and will pick
up on the jobs as soon as they're available (assuming you have sufficient
concurrency).

### Run greater concurrency

Either running more workers or have your workers have higher concurrency, or
both.

### Limit concurrency of slow tasks

Use the "limiting concurrency" techniques above on your slow tasks, which should
mean that you always have reserve capacity available for high priority jobs.

## Scale up on-demand

### Worker events

Use [the events system](/docs/worker-events) to detect when your workers are
overwhelmed, and scale up as necessary. One common signal for this is when the
`run_at` of a job that you start executing is significantly before the current
time minus the `pollInterval` (assuming that your database and worker clocks are
synchronized).
