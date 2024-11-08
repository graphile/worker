---
title: "Uninstall or Reset"
sidebar_position: 1000
---

To delete the worker code and all the jobs from your database, run this one SQL
statement:

```sql
DROP SCHEMA graphile_worker CASCADE;
```

If you're resetting your schema, make sure your workers are scaled down before you execute this.
