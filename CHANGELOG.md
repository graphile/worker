# Changelog

### v0.2.0 (unreleased)

BREAKING CHANGES:

- The `debug` task helper has been replaced with a `logger` helper which is a `Logger` instance (see README)
- The `-1` shortcut for "run once" never worked; it has been removed

New features:

- It's now possible to override how logs are output by supplying a `logFactory` (see README)
- `query` helper reduces boilerplate

### v0.1.0

- Add database 'error' handler to avoid crashes (@madflow #26)
- `DATABASE_URL` can now be used in place of `connectionString` (@madflow, @benjie ~~#20~~ #27)
- Improve documentation (@madflow, @archlemon, @benjie #11 #18 #31 #33)
- Improve testing (@madflow #19 #30)

### v0.1.0-alpha.0

Now usable as a library as well as a CLI.

Changes:

- Renamed a number of internals
  - `start` -> `runTaskList`
  - `runAllJobs` -> `runTaskListOnce`
  - `workerCount` -> `concurrency`
- Add an easy way to run as a library (`run` and `runOnce` methods)
- CLI code reduced as it uses new library code
- Implemented linting
- Exported more methods

### v0.0.1-alpha.7

- Add missing `tslib` dependency

### v0.0.1-alpha.6

- make poll interval configurable
- overhaul TypeScript types/interfaces
- more docs

### v0.0.1-alpha.5

- Fix casting (REQUIRES DB RESET)

### v0.0.1-alpha.4

- add `addJob` helper

### v0.0.1-alpha.3

- Travis CI
- Add `index.js`

### v0.0.1-alpha.2

- Docs

### v0.0.1-alpha.1

- More efficient job trigger
- Reduce latency

### v0.0.1-alpha.0

Initial release.
