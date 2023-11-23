---
title: TypeScript
sidebar_position: 65
---

Graphile Worker is written in TypeScript. By default, for safety, `payload`s are
typed as `unknown` since they may have been populated by out of date code, or
even from other sources. This requires you to add a type guard or similar to
ensure the `payload` conforms to what you expect. It can be convenient to
declare the payload types up front to avoid this `unknown`, but doing so might
be unsafe &mdash; please be sure to read the caveats below.

## Using type guards

To ensure your system is as safe as possible (and guard against old jobs, or
jobs specified outside of TypeScript's type checking) we recommend that you use
type guards to assert that your payload is of the expected type.

```ts
interface MyPayload {
  username: string;
}

function assertMyPayload(payload: any): asserts payload is MyPayload {
  if (
    typeof payload === "object" &&
    payload &&
    typeof payload.username === "string"
  ) {
    return;
  }
  throw new Error("Invalid payload, expected a MyPayload");
}

const task: Task = async (payload) => {
  assertMyPayload(payload);
  console.log(payload.username);
};
```

If this is too manual, you might prefer to use a library such as `runtypes` or
one of the many others of a similar kind.

### Example of using type guards

The following is an example implementation of sending emails using Amazon SES.

```ts
import type { Task, WorkerUtils } from "graphile-worker";
import { ses } from "./aws";

interface Payload {
  to: string;
  subject: string;
  body: string;
}

function assertPayload(payload: any): asserts payload is Payload {
  if (typeof payload !== "object" || !payload) throw new Error("invalid");
  if (typeof payload.to !== "string") throw new Error("invalid");
  if (typeof payload.subject !== "string") throw new Error("invalid");
  if (typeof payload.body !== "string") throw new Error("invalid");
}

export const send_email: Task = async function (payload) {
  assertPayload(payload);
  const { to, subject, body } = payload;
  await ses.sendEmail({
    Destination: {
      ToAddresses: [to],
      FromAddresses: ["no-reply@example.com"],
    },
    Message: {
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: body,
        },
      },
    },
  });
};
```

If now we introduce a new functionality to set the `from` address, we have to
take into account that older jobs will not have the `from` address set. We
should adjust our code like so:

```diff
import type { Task, WorkerUtils } from "graphile-worker";
import { ses } from "./aws";

interface Payload {
  to: string;
  subject: string;
  body: string;
+ from?: string;
}

function assertPayload(payload: any): asserts payload is Payload {
  if (typeof payload !== "object" || !payload) throw new Error("invalid");
  if (typeof payload.to !== "string") throw new Error("invalid");
  if (typeof payload.subject !== "string") throw new Error("invalid");
  if (typeof payload.body !== "string") throw new Error("invalid");
+ if (typeof payload.from !== "string" && typeof payload.from !== "undefined")
+   throw new Error("invalid");
}

export const send_email: Task = async function (payload) {
  assertPayload(payload);
- const { to, subject, body } = payload;
+ const { to, subject, body, from } = payload;
  await ses.sendEmail({
    Destination: {
      ToAddresses: [to],
-     FromAddresses: ["no-reply@example.com"],
+     FromAddresses: [from ?? "no-reply@example.com"],
    },
    Message: {
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: body,
        },
      },
    },
  });
};
```

## Assuming type via `GraphileWorker.Tasks`

As an alternative to the recommended use of type guards, you can register types
for Graphile Worker tasks using the following syntax in a shared TypeScript file
in your project:

```ts
declare global {
  namespace GraphileWorker {
    interface Tasks {
      // <name>: <payload type>; e.g.:
      myTaskIdentifier: { details: "are"; specified: "here" };
    }
  }
}
```

This should then enable auto-complete and payload type safety for `addJob` and
`quickAddJob`, and should also allow the payloads of your task functions to be
inferred when defined like this:

```ts
const task: Task<"myTaskIdentifier"> = async (payload, helpers) => {
  const { details, specified } = payload;
  /* ... */
};
```

or like this:

```ts
const tasks: TaskList = {
  async myTaskIdentifier(payload, helpers) {
    const { details, specified } = payload;
    /* ... */
  },
};
```

:::warning

Using TypeScript types like this can be misleading. Graphile Worker jobs can be
created in the database directly via the `graphile_worker.add_job()` or
`.add_jobs()` APIs; and these APIs cannot check that the payloads added conform
to your TypeScript types. Further, you may modify the payload type of a task in
a later version of your application, but existing jobs may exist in the database
using the old format. This can lead to you assuming that something is a number
when actually it&apos;s `null`, resulting in more bugs in your code, so care
must be taken.

We recommend you use type guards instead.

:::

### Example of assuming type

The following takes the Amazon SES example above, but uses the technique of
assuming type instead:

```ts
import type { Task, WorkerUtils } from "graphile-worker";
import { ses } from "./aws";

declare global {
  namespace GraphileWorker {
    interface Tasks {
      send_email: {
        to: string;
        subject: string;
        body: string;
      };
    }
  }
}

export const send_email: Task<"send_email"> = async function (payload) {
  const { to, subject, body } = payload;
  await ses.sendEmail({
    Destination: {
      ToAddresses: [to],
      FromAddresses: ["no-reply@example.com"],
    },
    Message: {
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: body,
        },
      },
    },
  });
};
```

If now we introduce the new functionality to set the from address, the changes
we make have to take into account that older jobs may not have the from address
set, like so:

```diff
import type { Task, WorkerUtils } from "graphile-worker";
import { ses } from "./aws";

declare global {
  namespace GraphileWorker {
    interface Tasks {
      send_email: {
        to: string;
        subject: string;
        body: string;
+       from?: string;
      };
    }
  }
}

export const send_email: Task<"send_email"> = async function (payload) {
- const { to, subject, body } = payload;
+ const { to, subject, body, from } = payload;
  await ses.sendEmail({
    Destination: {
      ToAddresses: [to],
-      FromAddresses: ["no-reply@example.com"],
+      FromAddresses: [from ?? "no-reply@example.com"],
    },
    Message: {
      Subject: {
        Charset: "UTF-8",
        Data: subject,
      },
      Body: {
        Text: {
          Charset: "UTF-8",
          Data: body,
        },
      },
    },
  });
};
```
