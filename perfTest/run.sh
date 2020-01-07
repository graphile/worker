#!/usr/bin/env bash
set -e

# run in this script's parent directory
cd "${0%/*}"

export NO_LOG_SUCCESS=1

export DATABASE_URL="${TEST_CONNECTION_STRING:-graphile_worker_perftest}"

if [ -x "$(command -v createdb)" ]; then
    # Reset the database if running locally
    dropdb graphile_worker_perftest || true
    createdb graphile_worker_perftest
fi

# Install the schema
node ../dist/cli.js --once

# How long does it take to start up and shut down?
time node ../dist/cli.js --once

# Schedule the jobs
node ./init.js

# Finally time the job execution
time node ../dist/cli.js --once

# And test latency
node ./latencyTest.js
