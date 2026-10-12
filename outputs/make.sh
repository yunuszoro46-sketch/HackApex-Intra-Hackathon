#!/bin/sh
# Regenerates our outputs on the public inputs by calling the running API (start it first with: npm start).
#   sh outputs/make.sh            (uses http://localhost:3000; set PORT to change)
set -e
cd "$(dirname "$0")/.."
URL="http://localhost:${PORT:-3000}/api/roster"
post() { curl -s -X POST -H 'content-type: application/json' --data @"$1" "$URL" -o "$2" -w "$1 -> $2 (HTTP %{http_code})\n"; }
post inputs/sample_input.json outputs/sample_output.json
if [ -f inputs/minute150_input.json ]; then
  post inputs/minute150_input.json outputs/minute150_output.json
else
  echo "inputs/minute150_input.json not present yet: save the official updated input there and run this again"
fi
