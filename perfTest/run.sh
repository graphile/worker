#!/usr/bin/env bash
set -e

# run in this script's parent directory
cd "${0%/*}"

export NO_LOG_SUCCESS=1

# if connection string not provided, assume postgres is available locally
export PERF_DATABASE_URL=${TEST_CONNECTION_STRING-graphile_worker_perftest}

echo
echo Drop and recreate the test database
echo
node ./recreateDb.js
# Install the schema
DATABASE_URL="$PERF_DATABASE_URL" node ../dist/cli.js --schema-only
echo

echo
echo How long does it take to start up and shut down?
echo
DATABASE_URL="$PERF_DATABASE_URL" time node ../dist/cli.js --once
echo

echo
echo Schedule 20,000 jobs
echo
node ./init.js
echo

echo
echo Time the job execution
echo
DATABASE_URL="$PERF_DATABASE_URL" time node ../dist/cli.js -j 24 -m 25 --once
echo

echo 'To work out jobs per second, divide 20000 by the total "elapsed" time above'

echo
echo Test latency
echo
node ./latencyTest.js
echo
