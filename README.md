# graphile-worker

Job queue for PostgreSQL.

- Uses `LISTEN`/`NOTIFY` to be informed of jobs as they're inserted
- Uses `SKIP LOCKED` to find jobs to execute, resulting in faster fetches
- Uses explicit task names / payloads reducing serialisation/deserialisation overhead
- Runs jobs in parallel by default
- Supports running jobs in series by adding them to the same queue
- Automatically re-attempts jobs with exponential back-off
- Simple implementation - easy to contribute to
- Executes tasks written in JavaScript, these can call out to any other language or networked service
- Modern JS with async/await