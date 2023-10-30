---
title: "Forbidden flags"
sidebar_position: 110
---

When a job is created (or updated via `job_key`), you may set its `flags` to a
list of strings. When the worker is run in library mode, you may pass the
`forbiddenFlags` option to indicate that jobs with any of the given flags should
not be executed.

```js
await run({
  // ...
  forbiddenFlags: forbiddenFlags,
});
```

The `forbiddenFlags` option can be:

- null
- an array of strings
- a function returning null or an array of strings
- an (async) function returning a promise that resolve to null or an array of
  strings

If `forbiddenFlags` is a function, `graphile-worker` will invoke it each time a
worker looks for a job to run, and will skip over any job that has any flag
returned by your function. You should ensure that `forbiddenFlags` resolves
quickly; it&apos;s advised that you maintain a cache you update periodically
(e.g. once a second) rather than always calculating on the fly, or use pub/sub
or a similar technique to maintain the forbidden flags list.

For an example of how this can be used to achieve rate-limiting logic, see the
[graphile-worker-rate-limiter project](https://github.com/politics-rewired/graphile-worker-rate-limiter)
and the discussion on
[issue #118](https://github.com/graphile/worker/issues/118).
