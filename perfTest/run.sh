#!/usr/bin/env bash
set -e

# run in this script's parent directory
cd "${0%/*}"

export NO_LOG_SUCCESS=1

# if connection string not provided, assume postgres is available locally
export PERF_DATABASE_URL=${TEST_CONNECTION_STRING-graphile_worker_perftest}

# drop and recreate the test database
node ./recreateDb.js

# Install the schema
DATABASE_URL=$PERF_DATABASE_URL node ../dist/cli.js --once

# How long does it take to start up and shut down?
DATABASE_URL=$PERF_DATABASE_URL time node ../dist/cli.js --once

# Schedule the jobs
node ./init.js

# Finally time the job execution
DATABASE_URL=$PERF_DATABASE_URL time node ../dist/cli.js --once

# And test latency
node ./latencyTest.js
