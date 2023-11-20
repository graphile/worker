---
title: "Pro configuration"
sidebar_position: 1000
---

Worker Pro configuration goes into your preset (typically stored in a
`graphile.config.ts` or similar file), inside the `worker` scope; see
[Configuration](../config.md) for more details on this file.

## Options

Worker Pro adds the following to the Graphile Worker options:

### worker.heartbeatInterval

Type: `number | undefined`

How often, in milliseconds, a worker should check in as active. Defaults to 1
minute.

<!--

### worker.sweepInterval

Type: `number | undefined`

How often, in milliseconds, to check for and release inactive workers. Defaults
to 3 minutes.

### worker.sweepThreshold

Type: `number | undefined`

How many milliseconds, since the last emitted heartbeat, may elapse before that
worker is considered inactive and eligible to be force-released. Defaults to 4
hours, but we recommend you set it to a shorter time &mdash; how long you think
a legitimate networking interruption might last where tasks may still
successfully complete.

-->

### worker.maxMigrationWaitTime

Type: `number | undefined`

How long, in milliseconds, to wait for active old workers to cleanly exit before
performing the migration to the newer database schema anyway. Defaults to 4
hours, but we recommend you set it to a smaller duration: the longest time you
expect one of your jobs to take to execute, plus a bit of padding.

## Example

```ts title="graphile.config.ts"
import "graphile-config";
import "graphile-worker";
import { WorkerProPreset } from "@graphile-pro/worker";

const preset: GraphileConfig.Preset = {
  extends: [WorkerProPreset],
  worker: {
    /* ... regular configuration here ...*/

    /* Example Worker Pro configuration options: */

    // Check in as active once per minute
    heartbeatInterval: 60 * 1000,

    // If old workers haven't exited within 30 minutes, go ahead and perform
    // the migration anyway:
    maxMigrationWaitTime: 30 * 60 * 1000,
  },
};

export default preset;
```

<!--
```
    // Check for and force-release inactive workers every 3 minutes
    sweepInterval: 3 * 60 * 1000,

    // Workers are deemed "inactive" 10 minutes after their last heartbeat
    sweepThreshold: 10 * 60 * 1000,
```
-->
