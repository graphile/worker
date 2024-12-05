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

1. Install yarn 1.x via the method of your choice.
2. Fork and clone the (Graphile Worker git
   repository)[https://github.com/graphile/worker]
3. From the root of your local Graphile Worker repository, run `yarn install`

### Automated Functional Testing

Graphile Worker leans on its automated tests to prevent regressions in
functionality and performance. After making any change to the source code, you
should run the test suite to ensure that you did not introduce any regressions.
Any edit to the expected behavior should also include an accompanying additon to
the test suite to prevent future regressions.

You must have a running Postgres database to run the tests. The test framework
creates a template database. Each test clones the template database on demand.
This allows the tests to run in parallel.

For now, the database used for testing must be available at localhost:5432 with
no username and password. The tests may be updated in the future to support
arbitrary database connection information.

Run `yarn test:setupdb` to setup the template database.

Then, you can run `yarn test:only` to run the tests. The tests can be rerun as
much as you want without rerunning `test:setupdb`.

:::note

If you have any files in `./tasks`, some tests will fail.

:::

### Running in CLI Mode

When Graphile Worker users run in CLI mode, they run the script defined in
`package.json` at `bin.graphile-worker`. To run your local version of Graphile
Worker similarly, compile the package and run `cli.js`.

```sh
yarn prepack
yarn cli -c "postgres:///my_db"
```

:::note

The command above will fail to start if you don't have any tasks defined.
`./tasks/` is included in the .gitignore, so you can add a simple hello world
task there if you don't have any tasks yet.

:::

See the [CLI documentation](./cli/run.md) for more information about CLI mode.

### Running in Library Mode

When Graphile Worker users run in library mode, they use the functions exported
in `src/index.ts`. The scrappiest thing you can do to run your local version of
Graphile Worker similarly is to create a Typescript file that runs functions
imported from `.`.

```ts title="src/temp.ts"
import { run } from ".";

async function main() {
  const runner = await run({
    connectionString: "postgres:///my_db",
    taskList: {
      hello: async (_, helpers) => {
        helpers.logger.info("Hello, world!");
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

Some people run their Graphile Worker development environments in Docker. The
`docker-compose.yml` file starts a minimal setup with a `db` container
containing a Postgres database and an `app` container that is similar to running
in CLI mode.

To run the `db` and `app` containers in the backround, run the following:

```sh
docker compose up -d
```

The tests currently rely on a database being available at localhost:5432. Thus,
you cannot currently run the tests in the Docker Compose setup.

Tail the containers' logs the with the following command:

```sh
docker compose logs -f db
docker compose logs -f app
```

### Authoring Database Migrations

New database migrations must be accompanied by an updated db dump. Before
generating a new dump, ensure the following:

1. You have a Postgres db running at localhost:5432.
2. You have `pg_dump`, and the version of `pg_dump` is the same major version of
   your Postgres database.

To check your `pg_dump` version, run the following:

```sh
pg_dump --version
```

To check the version of Postgres running at localhost:5432, run the following:

```sh
psql postgres:///my_db -c "SELECT version();"
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

## Contributing to the Documentation

The docs are maintained in the
[main Graphile Worker Repository](https://github.com/graphile/worker/tree/main/website/docs).
See the
[Website README](https://github.com/graphile/worker/blob/main/website/README.md)
for more info on the website.
