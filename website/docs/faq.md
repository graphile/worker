---
title: FAQ
---

Got a question?
[Submit an issue](https://github.com/graphile/worker/issues/new?assignees=&labels=%E2%9D%94+question&projects=&template=ask_a_question.md)
and maybe it'll end up on this page!

## Is LISTEN/NOTIFY used by default, and will this pose a problem for pgBouncer?

Yes, it's on by default. Yes, pgbouncer _might_ pose an issue if it's not done
in "connection" mode. We could probably disable it and do polling only (but we
don't currently have an option for that), or we could use a separate connection
string for the polling (but, again, we don't currently have an option for that
IIRC). The issue would be that the events won't necessarily be received, and too
many connections will be in the `LISTEN` state (potentially). Or none... Really
depends on the setup.

If you'd like to sponsor improvements in Graphile Worker to accommodate
pgBouncer better, please get in touch!

## If we have jobs that are scheduled in the future/failed will workers continuously poll to run those jobs, or will the LISTEN/NOTIFY mechanism be used for that?

We use polling for this. We cannot use `LISTEN`/`NOTIFY` since there's nothing
to generate an event when the time "ticks over".

You can change the poll frequency depending on how accurate you need these to
be; it defaults to 2 seconds, but 30 or even 60 seconds is probably fine if
you're having performance issues. That said; we always request a new job when
the previous job finishes anyway, so if you're scaled enough that your worker is
always at full capacity then the poll frequency (and `LISTEN`/`NOTIFY`) are kind
of irrelevant.

## Does each concurrent worker poll the db, or does each instance poll the db and then distribute the jobs to concurrent workers?

Each concurrent worker will ask for a job as soon as the previous job finishes.
Each instance will `LISTEN` for events and when it receives one it will pick an
idle worker to ask for jobs. If there is no idle worker then it'll drop the
event knowing that when one of the workers finishes they'll ask for the next job
anyway.
