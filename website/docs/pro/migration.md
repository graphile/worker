---
title: "Live migration"
sidebar_position: 10
---

Normally we recommend you shut down all of your Graphile Worker instances before
upgrading to certain new versions of Worker, since schema and API changes may
cause older workers to break, leading to long waits and/or duplicate execution
due to failure to mark jobs complete. To know which versions of Worker are
impacted, please see the [Release Notes](/releases).

Worker Pro performs checks on startup and
[tracks running workers](./recovery.md) so that each Worker can know if
they&apos;re out of date (in which case they should gracefully shut down) or if
they need to wait for previous worker versions to exit fully before they can run
migrations. Worker Pro understands which migrations are safe versus breaking,
and can help you to roll out new versions of Worker on a server-by-server basis
without having to scale your workers to zero before applying an update.

## Configuration

See [Pro configuration](./config.md) for details on how to configure Worker Pro,
including the full meaning of each option.

The live migration feature relies on the following settings:

- `heartbeatInterval` &mdash; worker checkin frequency
- `sweepInterval` &mdash; inactive worker check frequency
- `sweepThreshold` &mdash; how long since the last heartbeat before a worker is
  deemed "inactive"
- `maxMigrationWaitTime` &mdash; how long to wait for old active workers to
  complete current jobs before force migrating
