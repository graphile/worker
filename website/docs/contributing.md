---
title: "Contributing"
sidebar_position: 170
---

We love contributions from the community; but please: if you are planning to do
something big, talk to us first. Graphile Worker is quite opinionated and
prioritizes performance over many other things, so there is a risk that we may
not want your feature in core, and we do not want you to waste your time!

## Development

### Setup

1. Ensure `yarn` is installed (e.g. `npm install -g yarn`).
2. Fork and clone the (Graphile Worker git
   repository)[https://github.com/graphile/worker]
3. From the root of your local Graphile Worker repository, run `yarn install`

### Ensure PostgreSQL is running

We assume you have a local PostgreSQL server running in "trust" authentication
mode. Other options may or may not work - you may need to set `PGHOST`,
`PGPORT`, `PGUSER`, `PGPASSWORD` and/or similar config variables.

If you don't have such a server, you can use docker to run it locally:

```bash
# Run a temporary postgres instance on port 6432
docker run --rm -it -e POSTGRES_HOST_AUTH_METHOD=trust -p 6432:5432 postgres:17
```

Note that this Docker will keep running until you kill it (e.g. with `Ctrl-C`)
and thus you will need to continue with a different terminal window.

Be sure to set the required environmental variables for this setup before you
attempt to run the tests; you will need these for each terminal window that you
attempt to run the tests from:

```bash
export PGUSER=postgres
export PGHOST=127.0.0.1
export PGPORT=6432
```

The command `psql postgres` should now work (exit with `Ctrl-D`). We require
`psql` to install the test fixtures; if you don't have `psql` installed, install
it using your operating system's package manager or from the
[PostgreSQL website](https://www.postgresql.org/download/), for example:

```bash
sudo apt update && sudo apt install postgresql-client
```

### Automated Functional Testing

Graphile Worker leans on its automated tests to prevent regressions in
functionality and performance. After making any change to the source code, you
should run the test suite to ensure that you did not introduce any regressions.
Any edit to the expected behavior should also include an accompanying additon to
the test suite to prevent future regressions.

You must have a running Postgres database to run the tests. The test framework
creates a template database. Each test clones the template database on demand.
This allows the tests to run in parallel.

Run `yarn test` to run the tests, this will also set up the database.

:::tip Debugging

If you're having some trouble, you can run the tests in stages.

1. Compile the code: `yarn prepack`
2. Setup the test DB: `yarn test:setupdb`
3. Run the tests: `yarn test:only`

:::

:::warning Do not create a 'tasks' folder at the root!

If you have any files in `./tasks`, some tests will fail.

:::

### Running in CLI Mode

When users run the `graphile-worker` command they actually execute the script
defined in `package.json` under `bin.graphile-worker`, which is `dist/cli.js`
(corresponding with the `src/cli.ts` source file).

To run your local version of Graphile Worker similarly, run the `dist/cli.js`
file with `node` directly. It will fail to start if you don't have any tasks, so
you should create a tasks folder first (but not in the root!):

```sh
yarn prepack
mkdir -p _LOCAL/tasks
echo 'module.exports = () => {}' > _LOCAL/tasks/hello.js
cd _LOCAL
node ../dist/cli.js -c "postgres:///my_db"
```

:::tip Keep `dist` up to date with `yarn watch`

In development it's generally annoying to have to remember to run `yarn prepack`
before each action. Instead, run `yarn watch` in a different terminal and the
`dist` folder will stay up to date as you edit the source code.

:::

See the [CLI documentation](./cli/run.md) for more information about CLI mode.

### Running in Library Mode

When Graphile Worker users run in library mode, they use the functions exported
from `src/index.ts`. The scrappiest thing you can do to run your local version
of Graphile Worker similarly is to create a Typescript file that runs functions
imported from `.`.

```ts title="src/temp.ts"
import { run, WorkerPreset } from ".";

async function main() {
  const runner = await run({
    taskList: {
      hello: async (_, helpers) => {
        helpers.logger.info("Hello, world!");
      },
    },
    preset: {
      extends: [WorkerPreset],
      worker: {
        connectionString: "postgres:///my_db",
      },
    },
  });

  await runner.promise;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

Then you can run `temp.ts` with `ts-node`:

```sh
yarn run ts-node src/temp.ts
```

You have to remember not to commit `src/temp.ts`, so a cleaner way to achieve
this would be using `yarn link`. In the root of your local Graphile Worker
repository run the following:

```sh
yarn link
```

Create another node.js project with yarn that imports from `graphile-worker`
like it would if it was using the published package. In that directory, run the
following:

```sh
yarn link graphile-worker
```

Note that once you link, you still need to compile your local graphile-worker
package any time you make a change in the package that you want to test. You can
compile with the following command:

```sh
yarn prepack
```

If you're making frequent changes, you may want to automatically recompile any
time there is a change. You can do so with the following command:

```sh
yarn watch
```

See the [yarn link](https://classic.yarnpkg.com/lang/en/docs/cli/link/) docs for
more information about how linking works, including instructions for unlinking.

### Docker Compose

Some people run their Graphile Worker development environments in Docker
Compose. If this is you, please contribute back fixes to the setup, because our
lead maintainer does not use it.

The `docker-compose.yml` file starts a minimal setup with a `db` container
containing a Postgres database and an `app` container that is similar to running
in CLI mode.

To rebuild the docker containers, run:

```sh
docker compose build
```

To run the `db` and `app` containers in the backround, run the following:

```sh
docker compose up -d
```

You can run the tests via:

```sh
docker compose exec app yarn test
```

Tail the containers' logs the with the following command:

```sh
docker compose logs -f
```

### Authoring Database Migrations

New database migrations must be accompanied by an updated db dump. Before
generating a new dump, ensure the following:

1. You have a Postgres running as described above.
2. You have `pg_dump`, and the version of `pg_dump` is the same major version of
   your Postgres database.

To check your `pg_dump` version, run the following:

```sh
pg_dump --version
```

To check your Postgres version, run the following:

```sh
psql postgres:///template1 -c "SELECT version();"
```

To update the db dump, run the following command:

```sh
yarn db:dump
```

### Developing With Windows Machines

The maintainer does not have access to a Windows development machine, so he
cannot ensure that the development environment works.

[This comment](https://github.com/graphile/worker/pull/316#issuecomment-1427173046)
suggests that at least one change needs to be made to support contributing from
a Windows machine. If you use Windows and want to help here, please do!

One option is to try using the docker-compose setup detailed above.

## Contributing to the Documentation

The docs are maintained in the
[main Graphile Worker Repository](https://github.com/graphile/worker/tree/main/website/docs).
See the
[Website README](https://github.com/graphile/worker/blob/main/website/README.md)
for more info on the website.
