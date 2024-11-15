# Pool error handling

You're likely here because you received an error such as:

```
Your pool doesn't have error handlers! See: https://err.red/wpeh
```

This means you've passed your own
[pg.Pool instance](https://node-postgres.com/apis/pool) to Graphile Worker, but
that pool did not have error handling installed.

If an error occurs on the pool and there is no event handler installed Node
would exit
[as described in the Node.js docs](https://nodejs.org/api/events.html#error-events).
You get a network interruption, and your Worker might crash!

Don't worry, we've installed error handlers for you, but that's not ideal - you
should be handling this yourself. To do so, use code like this:

```ts
// Handle errors on the pool directly
pgPool.on("error", (err) => {
  console.error(`PostgreSQL idle client generated error: ${err.message}`);
});
// Handle errors on the client when it's checked out of the pool but isn't
// actively being used
pgPool.on("connect", (client) => {
  client.on("error", (err) => {
    console.error(`PostgreSQL active client generated error: ${err.message}`);
  });
});
```

Your code just needs to make sure the 'error' events on pool and client have
handlers installed; the handlers don't actually have to _do_ anything - they
could be NO-OPs.

Typically these kinds of errors would occur when e.g. the connection between
Node.js and PostgreSQL is interrupted (including when the PostgreSQL server
shuts down). In these cases since the client is likely not actively being
`await`-ed the error will have no handler, and will result in a process exit if
unhandled.
