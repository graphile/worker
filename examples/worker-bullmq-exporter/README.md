# Graphile-Worker delegation to BullMQ

This simple task allows you to export tasks to a
[BullMQ](https://github.com/taskforcesh/bullmq) queue.

You can use this to integrate tasks/events from the database level into
your redis-based task queue.

## Getting Started

- Make sure you have a redis instance available
  (also see [BullMQ docs](https://docs.bullmq.io/guide/connections))
- `npm install bullmq`
- Add the [bullmq-exporter](./tasks/bullmq-exporter.js) task to your
  Graphile Worker tasks
- Provide the required environment variables to the Graphile Worker process

Now you should be able to create bull tasks directly from your database:

```sql
SELECT graphile_worker.add_job('bullmq-exporter', json_build_object('key', 'value'));
```
