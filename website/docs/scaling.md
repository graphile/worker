---
title: Scaling tips
---

PostgreSQL is not what you'd build a job queue on if you're the size of
Facebook... But you're not the size of Facebook, right?

Postgres can get you pretty far, processing over 10,000 jobs per second in our
benchmarks. That's **almost a billion jobs per day**. Using Postgres as your job
queue via Graphile Worker can keep your infrastructure simple, enabling you to
focus less on infrastructure and more on getting your product's features to
market. But to maintain this performance, there's some things you must keep in
mind.

## Keep your jobs table small

Graphile Worker relies on the jobs table being small. v0.14.0 brought some
improvements that made it deal better with larger jobs tables, but the fastest
table to scan over is an empty one!

Graphile Worker automatically deletes jobs when they are complete to keep the
jobs table small; however if a job perma-fails we leave it so that you can debug
why it happened and handle the failure. **You should clear up perma-failed jobs
periodically** - either figure out why they failed, fix your task executor, and
then reduce the `attempts` number of the job so that it'll try again; or simply
delete the jobs.

```sql
-- WARNING: untested!
delete from graphile_worker.jobs where attempts = max_attempts and locked_at is null;
```

Jobs scheduled to run in the future can also keep the number of jobs in the jobs
table higher, impacting peak performance. Be thoughtful about these tasks, and
consider batching if it becomes an issue.

## Use the latest Graphile Worker release

We're constantly trying to improve the performance of worker; not just the peak
performance in the best situations, but also the baseline performance when
things are not at their best. v0.14.0 brought some major performance
improvements when the job queue is full of future-scheduled or perma-failed
jobs, for example.

## Do the vacuuming

The jobs table has extremely high churn; find a quiet period and give it a nice
`VACUUM` from time to time.

TODO: which `VACUUM` options should we recommend? Any other tables to VACUUM?

## Don't just jump to another queue!

If you're thinking about moving to another worker (and, when you reach the scale
to justify that, you should - generally start thinking about it when you're
getting to 5k+ jobs per second), I have plans that I've not had time to
implement w.r.t. batch exporting jobs to external queues. This may allow us to
get 10x or even 100x the speed since Worker needs to do less - this would mean
you don't need to rewrite the code that calls Worker, just the tasks themselves
would be implemented in another queue. If/when this is of interest, get in
touch!

Also if you are suffering some acute performance issue and you can replicate
your load onto a staging server or similar I'd love to run some experiments to
see if we can't squeeze more performance out of the system.
