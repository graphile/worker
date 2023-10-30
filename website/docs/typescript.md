---
title: TypeScript
sidebar_position: 65
---

Graphile Worker is written in TypeScript. By default, for safety, `payload`s are
typed as `unknown` since they may have been populated by out of date code, or
even from other sources. This requires you to add a type guard or similar to
ensure the `payload` conforms to what you expect. It can be convenient to
declare the payload types up front to avoid this `unknown`, but doing so might
be unsafe - please be sure to read the caveats below.

## `GraphileWorker.Tasks`

You can register types for Graphile Worker tasks using the following syntax in a
shared TypeScript file in your project:

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
when actually it's `null`, resulting in more bugs in your code, so care must be
taken.

We recommend you use type guards instead.

:::

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
the many others of a similar ilk. If you're not concerned with the type safety
of the payload, you can work around it with a couple casts:

```ts
const task: Task = (inPayload) => {
  const payload = inPayload as any as MyPayload;
};
```
