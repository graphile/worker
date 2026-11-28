---
"graphile-worker": patch
---

Fix a memory leak where each `run()` left its options object (and everything it
references) in the task identifier cache after the runner had stopped.
