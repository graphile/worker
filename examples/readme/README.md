Examples from the README, mostly for testing.

- `events.js` is a combination of the
  [Quickstart: library](https://github.com/graphile/worker/blob/main/README.md#quickstart-library)
  example with the
  [Example: listening to an event with `runner.events`](https://github.com/graphile/worker/blob/main/README.md#example-listening-to-an-event-with-runnerevents)
  example; it's designed to be run standalone
- `tasks/task_2.js` to be used with `await addJob("task_2", { foo: "bar" });`;
  to run this you can run `graphile-worker -c your_database_here` in this folder
  and it should pick up the task automatically.
