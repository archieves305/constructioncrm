#!/bin/sh
# Called by launchd every minute to process pending follow-up executions.
set -eu

: "${CRON_SECRET:?CRON_SECRET not set}"
: "${CRM_URL:=http://localhost:4000}"

curl -fsS -X POST "${CRM_URL}/api/cron/follow-ups" \
  -H "x-cron-secret: ${CRON_SECRET}" \
  -o /dev/null
