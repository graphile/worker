# Graphile-Worker use case

Use `graphile-worker` to export jobs to the [Faktory](https://github.com/contribsys/faktory) work server. With Faktory you can execute jobs with any language by clients using the Faktory API to fetch a job from a queue. 

# Tutorial

## Install Node dependencies

    yarn add faktory-worker
    yarn add graphile-worker

## Start a Postgres and Faktory instance

    docker run -it --rm -p 5432:5432 -d postgres:10-alpine

    docker run --rm -it -v faktory-data:/var/lib/faktory -e "FAKTORY_PASSWORD=faktorypass" -p 127.0.0.1:7419:7419 -p 127.0.0.1:7420:7420 contribsys/faktory:latest /faktory -b :7419 -w :7420 -e production

## Create a task file

```JS
// tasks/faktory-export.js
const faktory = require("faktory-worker");

module.exports = async ({ param }) => {
  // https://github.com/contribsys/faktory/wiki/The-Job-Payload
  const payloadOptions = {
    jobType: "FaktoryJob",
    queue: "graphile",
    args: [param],
  };
  const faktoryClient = await faktory.connect();

  const jid = await faktoryClient.push(payloadOptions);

  console.log(`Received jid from Faktory: ${jid}. Thanks Faktory!`);

  await faktoryClient.close();
};
```

## Run the worker and add a job for Faktory

1. Set required environment variables and start the worker 

```BASH
  export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
  export FAKTORY_URL=tcp://:faktorypass@localhost:7419
  $(yarn bin)/graphile-worker
```
2. Add a job

```SQL
  SELECT graphile_worker.add_job('faktory-exporter', '{"param": "sth"}');
```




