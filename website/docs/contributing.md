---
title: "Contributing"
sidebar_position: 170
---

We love contributions from the community; but please: if you&apos;re planning to
do something big, talk to us first. Graphile Worker is quite opinionated and
prioritizes performance over many other things, so there&apos;s a risk that we
may not want your feature in core, and we don&apos;t want you to waste your
time!

## Development

```sh
yarn install
yarn run watch
```

In another terminal:

```sh
createdb graphile_worker_test
yarn test
```

### Using Docker to develop this module

Start the dev db and app in the background

```sh
docker-compose up -d
```

Run the tests

```sh
docker-compose exec app yarn jest -i
```

Reset the test db

```sh
cat __tests__/reset-db.sql | docker-compose exec -T db psql -U postgres -v GRAPHILE_WORKER_SCHEMA=graphile_worker graphile_worker_test
```

Run the perf tests

```sh
docker-compose exec app node ./perfTest/run.js
```

monitor the container logs

```sh
docker-compose logs -f db
docker-compose logs -f app
```

### Database migrations

New database migrations must be accompanied by an updated db dump. This can be
generated using the command `yarn db:dump`, and requires a running postgres 12
server. Using docker:

```sh
docker run -e POSTGRES_HOST_AUTH_METHOD=trust -d -p 5432:5432 postgres:12
```

then run

```sh
PGUSER=postgres PGHOST=localhost yarn run db:dump
```
