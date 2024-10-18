#!/usr/bin/env bash

dropdb --if-exists graphile_worker_testtemplate
createdb graphile_worker_testtemplate
psql -X -v GRAPHILE_WORKER_SCHEMA="${GRAPHILE_WORKER_SCHEMA:-graphile_worker}" -v ON_ERROR_STOP=1 -f __tests__/reset-db.sql graphile_worker_testtemplate
node dist/cli.js --schema-only -c "postgres:///graphile_worker_testtemplate"
psql -X -v ON_ERROR_STOP=1 -c 'alter database graphile_worker_testtemplate with is_template = true;' graphile_worker_testtemplate
