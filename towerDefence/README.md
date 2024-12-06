# Tower defence test

With the advanced options like localQueue and refetchDelay, Graphile Worker gets
quite complex and testing it becomes a challenge. When there's enough work to go
around (as in `perfTest`), testing is easy and the system handles admirably. But
things become more complex when there's not enough work to go around: we still
want to execute jobs quickly, but we don't want all 10 Graphile Worker instances
sending a query to the DB each time a new job comes in.

This folder mounts a "tower defence"-style attack against a cluster of Graphile
Worker instances; it's designed to a) make sure no bugs happen, and b) let us
monitor system metrics under various load conditions. We start with the setup
phase where we build our towers (Graphile Worker instances) and then we send
different "waves" of jobs at the towers to ensure everything continues to work
smoothly.
