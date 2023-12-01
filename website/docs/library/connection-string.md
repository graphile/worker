---
title: "connectionString"
---

Under the hood, graphile-worker uses the
[pg-connection-string](https://www.npmjs.com/package/pg-connection-string)
package to deal with connection strings.

## TCP connection

Typically a simple TCP connection can be created with a connection string like:

```ts
const username = "your_database_username";
const password = "your_database_password";
const database = "your_database_name";
const host = "127.0.0.1";
const port = "5432";
const connectionString = `postgres://${username}:${password}@${host}:${port}/${database}`;
```

## Unix Domain Socket connection

### Google Cloud SQL via Unix Domain Socket

When using graphile-worker with a PostgreSQL database hosted on Google Cloud
SQL, it's recommended to connect through a Unix domain socket for enhanced
security and reliability. This method requires the use of the Cloud SQL Proxy,
which provides a stable connection to your Cloud SQL instance.

The connectionString is constructed using the `socket:` protocol, followed by
the URI-encoded username and password, the socket path, and the URI-encoded
database name as a query parameter (`?db=`).

The connection string will look something like this:

```ts
const username = encodeURIComponent("your_database_username");
const password = encodeURIComponent("your_database_password");
const database = encodeURIComponent("your_database_name");
const instanceConnectionName = "your_project_id:your_region:your_instance_id"; // As provided by Google Cloud SQL
const socketPath = `/cloudsql/${instanceConnectionName}`;
const connectionString = `socket://${username}:${password}@${socketPath}?db=${database}`;
```

- username: Your database username, URI-encoded
- password: Your database password, URI-encoded
- database: The name of your database, URI-encoded
- instanceConnectionName: The connection name of your Google Cloud SQL instance,
  typically in the format of project-id:region:instance-id
- socketPath: The path to the Unix domain socket created by the Cloud SQL Proxy

#### Example:

```ts
import { run, Runner } from "graphile-worker";

const username = encodeURIComponent("your_database_username");
const password = encodeURIComponent("your_database_password");
const database = encodeURIComponent("your_database_name");
const instanceConnectionName = "your_project_id:your_region:your_instance_id"; // As provided by Google Cloud SQL
const socketPath = `/cloudsql/${instanceConnectionName}`;
const connectionString = `socket://${username}:${password}@${socketPath}?db=${database}`;

async function main() {
  try {
    const runner: Runner = await run({
      connectionString,
      // Additional `graphile-worker` configuration as required
    });

    await runner.promise;
  } catch (err: unknown) {
    console.error("Error running graphile-worker:", err);
    process.exit(1);
  }
}

export default main();
```
