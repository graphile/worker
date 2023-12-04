---
title: "CLI"
sidebar_position: 50
---

There are two main ways to run Graphile Worker: CLI mode and library mode. CLI
mode is the easiest to get started with, and is what we recommend for the
majority of users. If in doubt go with the CLI - you can always change to
library mode later if you need to.

## Quickstart

In your existing Node.js project:

### Add the worker to your project

```sh npm2yarn
npm install --save graphile-worker
```

### Create tasks

Create a `tasks/` folder, and place in it JS files containing your task specs.
The names of these files will be the task identifiers, e.g. `hello` below:

```js title="tasks/hello.js"
module.exports = async (payload, helpers) => {
  const { name } = payload;
  helpers.logger.info(`Hello, ${name}`);
};
```

### Run the worker

(Make sure you&apos;re in the folder that contains the `tasks/` folder.)

Run Graphile Worker passing in your database
[connection string](../connection-string.md):

```bash
npx graphile-worker -c "postgres:///my_db"
# or, if you have a remote database, something like:
#   npx graphile-worker -c "postgres://user:pass@host:port/db?ssl=true"
# or, if you prefer envvars
#   DATABASE_URL="..." npx graphile-worker
```

:::note

`npx` runs the local copy of an npm module if it is installed, when you&apos;re
ready, switch to using the `package.json` `"scripts"` entry instead.

:::

### Add a job via SQL

Connect to your database and run the following SQL:

```sql
SELECT graphile_worker.add_job('hello', json_build_object('name', 'Bobby Tables'));
```

### Success!

You should see the worker output `Hello, Bobby Tables`. Gosh, that was fast!
