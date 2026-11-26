---
"graphile-worker": patch
---

Fix loading task lists from file paths containing `#` or `%`. These characters
are now treated literally, so percent escapes cannot select a different file.
