---
title: "Uninstall/Reset"
sidebar_position: 1000
---

To delete the worker code and all the jobs from your database, run this one SQL
statement:

```sql
DROP SCHEMA graphile_worker CASCADE;
```

(If you are using an alternative schema for Graphile Worker, please update the
command accordingly.)

:::danger This may also drop some of your database functions/constraints!

Any functionality in your database that depends on Graphile Worker (according to
PostgreSQL's tracking of dependencies - see
[pg_depend](https://www.postgresql.org/docs/current/catalog-pg-depend.html) in
the PostgreSQL docs) may also be dropped by the `CASCADE`; this includes
database functions (including trigger functions), and foreign key constraints.

It's recommended to try this on a non-production environment first to see its
effects, and to do a schema-only dump of your database before and after to
compare the changes and look for unexpected consequences.

:::

:::warning Scale to zero first!

Before running this command, you should make sure there are no running Graphile
Worker instances.

:::
