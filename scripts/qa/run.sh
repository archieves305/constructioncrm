#!/bin/bash
# The regression suite, end to end, on the dev database only:
#   dump → exact row counts → dev server as ADMIN: flows, smoke, axe →
#   dev server as SALES_REP: roles, smoke → dev server as READ_ONLY: smoke →
#   restore → row counts must match.
# usage: scripts/qa/run.sh [all|flows|smoke|axe|roles|crew|smoke-roles]   (default all)
# Needs: the local Postgres in .env, the cached Chromium headless shell
# (or QA_CHROMIUM), port 4000 free. Mail, SMS and AI keys are blanked, so nothing is sent.
set -uo pipefail
cd "$(dirname "$0")/../.."
WHAT="${1:-all}"
OUT="${QA_OUT:-qa-out}"; mkdir -p "$OUT"
DB_URL="${DATABASE_URL:-$(sed -n 's/^DATABASE_URL *= *"\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env | head -1)}"
DB_URL="${DB_URL%%\?*}"
case "$DB_URL" in
  *@localhost[:/]*|*@127.0.0.1[:/]*|postgres:///*|postgresql:///*|*@/*) ;;
  *) echo "qa: refusing to run — DATABASE_URL is not on this machine"; exit 2 ;;
esac
ADMIN_EMAIL="${QA_ADMIN_EMAIL:-richard@rcareylaw.com}"
REP_EMAIL="${QA_REP_EMAIL:-john.rep@constructioncrm.com}"
DUMP="$OUT/dev-before.dump"
SERVER_PID=""

counts() {
  psql "$DB_URL" -Atc "select string_agg(format('select %L||''=''||count(*) from %I', tablename, tablename), ' union all ' order by tablename) from pg_tables where schemaname='public'" | psql "$DB_URL" -At
}
stop_server() {
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
  SERVER_PID=""
  pkill -f "next dev -p 4000" 2>/dev/null; sleep 1
}
start_server() { # $1 email, $2 role
  stop_server
  CAREYOS_SSO_DEV_BYPASS=1 CAREYOS_DEV_EMAIL="$1" CAREYOS_DEV_ROLE="$2" \
    MAILERSEND_API_KEY= ANTHROPIC_API_KEY= TWILIO_ACCOUNT_SID= TWILIO_AUTH_TOKEN= ZYLOW_API_KEY= \
    npx next dev -p 4000 > "$OUT/dev-$2.log" 2>&1 &
  SERVER_PID=$!
  echo "qa: dev server as $2 (log $OUT/dev-$2.log)"
}
finish() {
  stop_server
  # The dev bypass writes its role onto the user; put the rep back.
  psql "$DB_URL" -qc "update users set role_id = (select id from roles where name = 'SALES_REP') where email = '$REP_EMAIL'" >/dev/null 2>&1
  if [ -f "$DUMP" ]; then
    pg_restore --clean --if-exists --no-owner -d "$DB_URL" "$DUMP" 2>"$OUT/restore.err" || true
    psql "$DB_URL" -qc "update users set role_id = (select id from roles where name = 'SALES_REP') where email = '$REP_EMAIL'" >/dev/null 2>&1
    counts > "$OUT/counts-after.txt"
    if diff -q "$OUT/counts-before.txt" "$OUT/counts-after.txt" >/dev/null; then
      echo "qa: dev database restored — exact row counts unchanged"
    else
      echo "qa: WARNING dev database differs from before:"; diff "$OUT/counts-before.txt" "$OUT/counts-after.txt" | head -20; FAIL=1
    fi
  fi
  echo "qa: results in $OUT/*.json"
  exit "${FAIL:-0}"
}
trap finish EXIT INT TERM

FAIL=0
run() { node "$@" || FAIL=1; }

pg_dump -Fc "$DB_URL" -f "$DUMP" || { echo "qa: pg_dump failed"; exit 1; }
counts > "$OUT/counts-before.txt"
rm -f "$OUT/state.json"

if [[ "$WHAT" =~ ^(all|flows|smoke|axe)$ ]]; then
  start_server "$ADMIN_EMAIL" ADMIN
  [[ "$WHAT" =~ ^(all|flows)$ ]] && run scripts/qa/flows.mjs ${QA_FLOWS:-}
  [[ "$WHAT" =~ ^(all|smoke)$ ]] && run scripts/qa/smoke.mjs
  [[ "$WHAT" =~ ^(all|axe)$ ]] && run scripts/qa/axe.mjs
fi
if [[ "$WHAT" =~ ^(all|roles)$ ]]; then
  [ "$WHAT" = roles ] && { start_server "$ADMIN_EMAIL" ADMIN; run scripts/qa/flows.mjs "^(lead|expense|crewpay|co|permit|calendar)$"; }
  start_server "$REP_EMAIL" SALES_REP
  run scripts/qa/roles.mjs
  if [ "$WHAT" = all ]; then
    run scripts/qa/smoke.mjs
    # The same account as READ_ONLY (finish() puts it back to SALES_REP).
    start_server "$REP_EMAIL" READ_ONLY
    run scripts/qa/smoke.mjs
  fi
fi
if [[ "$WHAT" =~ ^(all|crew)$ ]]; then
  # The crew mode (Release 1): the rep account as a crew lead on flows.mjs's job.
  [ "$WHAT" = crew ] && { start_server "$ADMIN_EMAIL" ADMIN; run scripts/qa/flows.mjs "^(lead)$"; }
  start_server "$REP_EMAIL" CREW_LEAD
  run scripts/qa/crew.mjs
  # Release 2: the same account as a crew member (finish() puts it back).
  start_server "$REP_EMAIL" CREW_MEMBER
  run scripts/qa/crew-member.mjs
fi
if [ "$WHAT" = smoke-roles ]; then
  # Only the page sweep as the rep and as READ_ONLY (to recheck a flaky pass).
  start_server "$REP_EMAIL" SALES_REP
  run scripts/qa/smoke.mjs
  start_server "$REP_EMAIL" READ_ONLY
  run scripts/qa/smoke.mjs
fi
