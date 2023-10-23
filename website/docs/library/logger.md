---
title: "Library: Logger"
sidebar_label: "Logger"
---

We use [`@graphile/logger`](https://github.com/graphile/logger) as a log
abstraction so that you can log to whatever logging facilities you like. By
default this will log to `console`, and debug-level messages are not output
unless you have the environmental variable `GRAPHILE_LOGGER_DEBUG=1`. You can
override this by passing a custom `logger`.

It's recommended that your tasks always use the methods on `helpers.logger` for
logging so that you can later route your messages to a different log store if
you want to. There are 4 methods, one for each level of severity (`error`,
`warn`, `info`, `debug`), and each accept a string as the first argument and
optionally an arbitrary object as the second argument:

- `helpers.logger.error(message: string, meta?: LogMeta)`
- `helpers.logger.warn(message: string, meta?: LogMeta)`
- `helpers.logger.info(message: string, meta?: LogMeta)`
- `helpers.logger.debug(message: string, meta?: LogMeta)`

You may customise where log messages from `graphile-worker` (and your tasks) go
by supplying a custom `Logger` instance using your own `logFactory`.

```js
const { Logger, run } = require("graphile-worker");

/* Replace this function with your own implementation */
function logFactory(scope) {
  return (level, message, meta) => {
    console.log(level, message, scope, meta);
  };
}

const logger = new Logger(logFactory);

// Pass the logger to the 'run' method as part of options:
run({
  logger,
  /* pgPool, taskList, etc... */
});
```

Your `logFactory` function will be passed a scope object which may contain the
following keys (all optional):

- `label` (string): a rough description of the type of action ('worker' and
  'job' are the currently used values).
- `workerId` (string): the ID of the worker instance
- `taskIdentifier` (string): the task name (identifier) of the running job
- `jobId` (number): the id of the running job

And it should return a logger function which will receive these three arguments:

- `level` ('error', 'warning', 'info' or 'debug') - severity of the log message
- `message` (string) - the log message itself
- `meta` (optional object) - may contain other useful metadata, useful in
  structured logging systems

The return result of the logger function is currently ignored; but we strongly
recommend that for future compatibility you do not return anything from your
logger function.

See the [`@graphile/logger`](https://github.com/graphile/logger) documentation
for more information.

**NOTE**: you do not need to (and should not) customise, inherit or extend the
`Logger` class at all.

**NOTE**: some log messages are gated behind the
`GRAPHILE_ENABLE_DANGEROUS_LOGS=1` environmental variable - to see them you will
need to enable that envvar AND enable debug logging (e.g. with
`GRAPHILE_LOGGER_DEBUG=1` as mentioned above) - do not do this in production as
these logs may include incredibly sensitive details such as your full database
connection string including password.
