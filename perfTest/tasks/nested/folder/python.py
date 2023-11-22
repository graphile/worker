#!/usr/bin/env python

import json, os, sys

if os.environ["GRAPHILE_WORKER_PAYLOAD_FORMAT"] <> "json":
    print("Graphile Worker binary payload format {} unsupported".format(os.environ["GRAPHILE_WORKER_PAYLOAD_FORMAT"]))
    exit(99)

input_string = sys.stdin.read()
input_object = json.loads(input_string)

current_attempts = int(os.environ["GRAPHILE_WORKER_JOB_ATTEMPTS"])
expected_attempts = int(input_object["payload"]["attempts"])
if current_attempts >= expected_attempts:
    print("All good")
else:
    print("Oh noes! {current_attempts} < {expected_attempts}".format(current_attempts = current_attempts, expected_attempts = expected_attempts))
    exit(1)
