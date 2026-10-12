#!/bin/sh
# Replays every evidence input against the running API (start it first with: npm start).
#   sh evidence/run.sh            (uses http://localhost:3000; set PORT to change)
set -e
cd "$(dirname "$0")/.."
URL="http://localhost:${PORT:-3000}/api/roster"
post() { curl -s -X POST -H 'content-type: application/json' --data @"$1" "$URL" -o "$2" -w "$1 -> $2 (HTTP %{http_code}, %{time_total}s)\n"; }
post evidence/regression/input_all_outage_small_shops.json evidence/regression/after_output.json
post evidence/boundary/input_budget_exact.json evidence/boundary/output_budget_exact.json
post evidence/boundary/input_budget_one_hundredth_short.json evidence/boundary/output_budget_one_hundredth_short.json
post evidence/regression_timeout/input_fuzz_case77.json evidence/regression_timeout/after_output.json
