---
title: "Docker"
sidebar_position: 150
---

## Using the official Docker image

```
docker pull graphile/worker
```

When using the Docker image you can pass any supported options to the command
line or use the supported environment variables. For the current list of
supported command line options you can run:

`docker run --init --rm -it graphile/worker --help`

Adding tasks to execute is done by mounting the `tasks` directory as a volume
into the `/worker` directory.

The following example has a `tasks` directory in the current directory on the
Docker host. The PostgreSQL server is also running on the same host.

```bash
docker run \
  --init \
  --rm -it \
  --network=host \
  -v "$PWD/tasks":/worker/tasks \
  graphile/worker \
    -c "postgres://postgres:postgres@localhost:5432/postgres"
```
