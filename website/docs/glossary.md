---
title: "Glossary"
---

Here are some of the terms you may come across when using Graphile Worker:

## Task

Something that can be executed, the type of work that a Job may take, such as
&ldquo;send email&rdquo;, &ldquo;convert image&rdquo; or &ldquo;process
webhook&rdquo;.

## Task identifier

The unique name given to a task, for example `send_email` or `convert_image`.

## Task executor

The code responsible for executing a particular task; typically defined via a
JavaScript or TypeScript function:

```ts
import type { Task } from "graphile-worker";
import { ses, Source } from "../lib/aws-ses.js";

export const send_email: Task = async (payload, helpers) => {
  const send = ses.sendEmail({
    Destination: { ToAddresses: [payload.address] },
    Message: {
      Subject: { Charset: "UTF-8", Data: payload.subject },
      Body: { Text: { Charset: "UTF-8", Data: payload.body } },
    },
    Source,
  });
  await send.promise();
};
```

## Job

A record in the `graphile_worker.jobs` table which represents a single
&ldquo;job to be done&rdquo;: which Task to execute and what parameters
(Payload) to execute it with. Also stores additional details such as how many
attempts it has had so far, what the max attempts are, when it will be attempted
next, etc. Created via the [JS `addJob()`](/docs/library/add-job) or
[SQL `graphile_worker.add_job()`](/docs/sql-add-job) function.

## Payload

The data associated with a particular Job, for example a job might reference the
`send_email` Task and indicate via the Payload the `address` to which to send
the email plus the `subject` and `body` of the email.

## Worker

A JS routine that is provided a list of Tasks it is capable of executing and
then looks for a single Job to execute matching one of the provided Tasks.
Executes the Job, reporting success or failure back to the database. Then finds
the next Job and continues this process.

## WorkerPool

Manages a collection of Workers such that multiple Jobs can be executed in
parallel (within the constraints of the Node.js event loop). Responsible for
listening for and dispatching new job events.

## Cron

A system of executing [recurring tasks](/docs/cron).

## Runner

Manages a Cron instance and a WorkerPool instance; if you're using Graphile
Worker in "library mode" then this is the main way you would execute Graphile
Worker. (Really small piece of code:
https://github.com/graphile/worker/blob/99b15438847a87532c122ac4ed8233a3245556e7/src/runner.ts#L69-L106)

## Graceful shutdown

When a WorkerPool stops accepting new jobs and exits once all its Workers have
finished their currently executing jobs. This is triggered on a SIGTERM/SIGINT
or similar signal, or via the `runner.stop()` API.

## Forceful shutdown

When a WorkerPool stops accepting new jobs and explicitly unlocks all in
progress tasks. The process should exit as soon as the in progress tasks have
been unlocked, to ensure that they do not continue to be processed.
