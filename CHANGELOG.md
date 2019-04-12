# Changelog

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
