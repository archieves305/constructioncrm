#!/usr/bin/env bash
#
# deploy.sh — KNUCO CRM dev → prod deploy script
# ====================================================================
#
# Run from the KNUCO repo root on a workstation that has SSH access to
# knuco-droplet. Ships local HEAD to /opt/knuco on the droplet, applies
# pending Prisma migrations, builds, restarts the service, with pre-deploy
# backups and on-failure code rollback.
#
# USAGE:
#   ./deploy.sh                      Interactive deploy (prompts before changes)
#   ./deploy.sh --yes                Skip confirmation prompt
#   ./deploy.sh --dry-run            Run pre-flight + show plan, then exit
#   ./deploy.sh --auto-rollback-db   On failure, restore DB from pre-deploy
#                                    backup. DESTRUCTIVE. Off by default.
#   ./deploy.sh --allow-divergent    DANGER: skip the local-vs-origin/main
#                                    divergence check. For "origin unreachable,
#                                    must ship now" emergencies only. Requires
#                                    explicit "YES I UNDERSTAND" confirmation
#                                    even with --yes.
#   ./deploy.sh --help               Show this help
#
# EXIT CODES:
#   0   success
#   1   uncategorized error (also: divergence confirmation declined)
#   2   not on main branch
#   3   working tree dirty
#   4   local ahead of origin/main (use --allow-divergent to override)
#   5   local behind origin/main (use --allow-divergent to override)
#   6   ssh to droplet failed
#   7   pre-deploy DB backup failed
#   8   pre-deploy DB backup file too small
#   9   pre-deploy code tarball failed
#   10  rsync failed
#   14  remote install/migrate/build chain failed
#   16  systemctl restart failed
#   17  service did not become active within 30s
#   18  droplet-side curl smoke test failed
#   19  laptop-side curl smoke test failed
#   20  journal contained error patterns after restart
#   30  another deploy in progress (PID recorded in /tmp/knuco-deploy.lock.d/pid, still alive)
#
# DESIGN NOTES:
# - npm ci uses --include=dev because /etc/knuco/env sets NODE_ENV=production,
#   and npm omits devDependencies under that. The codebase keeps build-time
#   deps (tailwindcss, @tailwindcss/postcss, typescript, @types/*) in
#   devDependencies. This is the build-on-server compromise. (See Phase 7.5
#   in MIGRATION_LOG.md for the incident that taught us this.)
# - prisma migrate status returns exit 1 when migrations are pending. Pre-deploy
#   call wraps in `|| true` because pending IS the expected state pre-deploy.
#   Post-deploy call is strict and grep's for "Database schema is up to date!"
#   because exit 0 alone is not sufficient evidence migrate deploy applied
#   everything.
# - Code rollback (extract pre-deploy tarball + restart) is automatic on any
#   post-rsync failure. DB rollback is OPT-IN via --auto-rollback-db: most
#   KNUCO migrations are additive and tolerate forward-only schema, but you
#   must judge per deploy. Manual DB rollback recipe is printed when
#   --auto-rollback-db is off and a code rollback happens.
# - Lock is mkdir-based (not flock) for macOS/Linux/BSD portability. Stale-lock
#   recovery via kill -0 PID check.

set -euo pipefail

# ============================================================================
# Constants
# ============================================================================

DROPLET="knuco-droplet"
REMOTE_APP="/opt/knuco"
REMOTE_BACKUP_DIR="/var/backups/knuco"
REMOTE_LOG_DIR="/var/log/knuco"
REMOTE_LOG_FILE="${REMOTE_LOG_DIR}/deploy.log"
PUBLIC_URL="https://crm.knuconstruction.com"
LOCAL_PORT_URL="http://127.0.0.1:4000"
LOCK_DIR="/tmp/knuco-deploy.lock.d"
TARBALL_RETENTION=7  # Must be >= 2 to guarantee newly-created tarball survives the trim step.
TS="$(date +%Y%m%d-%H%M%S)"
START_EPOCH=$(date +%s)

LOCAL_LOG_DIR="${HOME}/knuco-deploys"
LOCAL_LOG_FILE="${LOCAL_LOG_DIR}/${TS}.log"

# Resolve repo root: directory where this script lives.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_REPO="${SCRIPT_DIR}"

# ============================================================================
# Argument parsing
# ============================================================================

YES=0
DRY_RUN=0
AUTO_ROLLBACK_DB=0
ALLOW_DIVERGENT=0

show_help() {
    sed -n '2,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        --yes) YES=1 ;;
        --dry-run) DRY_RUN=1 ;;
        --auto-rollback-db) AUTO_ROLLBACK_DB=1 ;;
        --allow-divergent) ALLOW_DIVERGENT=1 ;;
        --help|-h) show_help ;;
        *) echo "Unknown flag: $1" >&2; echo "Try --help" >&2; exit 1 ;;
    esac
    shift
done

# ============================================================================
# Logging — tee everything to local log
# ============================================================================

mkdir -p "$LOCAL_LOG_DIR"
exec > >(tee -a "$LOCAL_LOG_FILE") 2>&1

# ============================================================================
# Lock — only one deploy at a time (mkdir-based for portability)
# ============================================================================

LOCK_HELD=0

acquire_lock() {
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$LOCK_DIR/pid"
        LOCK_HELD=1
        return 0
    fi
    local lock_pid
    lock_pid=$(cat "$LOCK_DIR/pid" 2>/dev/null || echo "")
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
        echo "ERROR: another deploy is already in progress (PID $lock_pid)"
        exit 30
    fi
    echo "WARNING: stale lock from PID $lock_pid; cleaning up"
    rm -rf "$LOCK_DIR"
    if mkdir "$LOCK_DIR" 2>/dev/null; then
        echo $$ > "$LOCK_DIR/pid"
        LOCK_HELD=1
        return 0
    fi
    echo "ERROR: lock acquisition failed after stale cleanup"
    exit 30
}

acquire_lock

# ============================================================================
# State for trap-based rollback
# ============================================================================

BACKUP_FILE=""
TARBALL_FILE=""
RSYNC_DONE=0
MIGRATE_DEPLOY_DONE=0
BUILD_DONE=0
RESTART_DONE=0
DEPLOY_OK=0
PHASE="init"

# ============================================================================
# Trap handlers
# ============================================================================

rollback_code() {
    if [ -z "$TARBALL_FILE" ]; then
        echo "ROLLBACK ERROR: no tarball recorded — cannot roll back code automatically."
        echo "Manual recovery: previous /opt/knuco state is in $REMOTE_BACKUP_DIR/pre-deploy-*.tar.gz (newest)."
        return 1
    fi
    # Sanity-check the tarball still exists and has reasonable size.
    if ! ssh "$DROPLET" "sudo test -s $TARBALL_FILE"; then
        echo "ROLLBACK ERROR: tarball $TARBALL_FILE missing or empty. Manual recovery needed."
        return 1
    fi
    echo "Restoring /opt/knuco from $TARBALL_FILE ..."
    ssh "$DROPLET" "sudo tar xzf $TARBALL_FILE -C /opt && sudo chown -R knuco:knuco /opt/knuco" || {
        echo "ROLLBACK FAILED: tar xzf returned non-zero. Manual recovery needed."
        return 1
    }
    if [ $RESTART_DONE -eq 1 ]; then
        echo "Restarting knuco.service after code restore ..."
        ssh "$DROPLET" "sudo systemctl restart knuco" || echo "ROLLBACK WARNING: systemctl restart failed; service may be down"
    fi
    if [ $MIGRATE_DEPLOY_DONE -eq 1 ]; then
        echo ""
        echo "================================================================"
        echo "WARNING: prisma migrate deploy completed before this failure."
        echo "DB schema is now AHEAD of restored code."
        if [ $AUTO_ROLLBACK_DB -eq 1 ]; then
            if [ -n "$BACKUP_FILE" ] && ssh "$DROPLET" "sudo test -s $BACKUP_FILE"; then
                echo "Restoring DB from $BACKUP_FILE (--auto-rollback-db)..."
                ssh "$DROPLET" "sudo systemctl stop knuco && sudo -u postgres pg_restore --clean --if-exists -d knuco $BACKUP_FILE && sudo systemctl start knuco" \
                    && echo "DB restored." \
                    || echo "DB RESTORE FAILED. Manual intervention required."
            else
                echo "AUTO-ROLLBACK-DB requested but $BACKUP_FILE missing or empty. Skipping."
            fi
        else
            echo ""
            echo "Manual DB rollback (run from droplet as a user with sudo):"
            echo "  sudo systemctl stop knuco"
            echo "  sudo -u postgres pg_restore --clean --if-exists -d knuco $BACKUP_FILE"
            echo "  sudo systemctl start knuco"
            echo ""
            echo "Note: KNUCO migrations are typically additive. Forward-only schema"
            echo "may be safe; review the failed migrate's diff before deciding."
            echo "================================================================"
        fi
    fi
}

on_exit() {
    local rc=$?
    set +e
    local elapsed=$(( $(date +%s) - START_EPOCH ))
    echo ""
    echo "================================================================"
    if [ $DEPLOY_OK -eq 1 ]; then
        echo "DEPLOY: SUCCESS (elapsed ${elapsed}s)"
    else
        echo "DEPLOY: FAILED (rc=${rc}, last phase=${PHASE}, elapsed ${elapsed}s)"
        if [ $RSYNC_DONE -eq 1 ]; then
            echo ""
            echo "Attempting code rollback from pre-deploy tarball..."
            rollback_code
        else
            echo "No code rollback needed (rsync did not occur)."
        fi
    fi
    echo "================================================================"
    # Always try to ship the local log to the droplet for the audit trail.
    if ssh -o ConnectTimeout=5 -o BatchMode=yes "$DROPLET" 'true' 2>/dev/null; then
        ssh "$DROPLET" "sudo install -d -m 755 -o root -g root $REMOTE_LOG_DIR" 2>/dev/null || true
        if scp -q "$LOCAL_LOG_FILE" "$DROPLET:/tmp/knuco-deploy-${TS}.log" 2>/dev/null; then
            ssh "$DROPLET" "sudo bash -c 'cat /tmp/knuco-deploy-${TS}.log >> $REMOTE_LOG_FILE && rm /tmp/knuco-deploy-${TS}.log'" 2>/dev/null \
                || echo "WARNING: failed to append local log to $REMOTE_LOG_FILE"
        else
            echo "WARNING: scp of local log to droplet failed"
        fi
    else
        echo "WARNING: droplet unreachable for log shipment (local log retained at $LOCAL_LOG_FILE)"
    fi
    [ $LOCK_HELD -eq 1 ] && rm -rf "$LOCK_DIR"
    exit $rc
}
trap on_exit EXIT

fail() {
    local code=$1; shift
    echo "ERROR ($code): $*" >&2
    exit "$code"
}

# ============================================================================
# Header
# ============================================================================

echo "================================================================"
echo "KNUCO CRM deploy script"
echo "Started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Operator: $(whoami)@$(hostname -s)"
echo "Local log: $LOCAL_LOG_FILE"
[ $DRY_RUN -eq 1 ] && echo "MODE: DRY RUN (no changes will be made)"
[ $YES -eq 1 ] && echo "MODE: --yes (skip confirmation)"
[ $AUTO_ROLLBACK_DB -eq 1 ] && echo "MODE: --auto-rollback-db (DB will be restored on failure)"
[ $ALLOW_DIVERGENT -eq 1 ] && echo "MODE: --allow-divergent (DANGER: divergence check skipped)"
echo "================================================================"

# ============================================================================
# Phase 1 — Local pre-flight
# ============================================================================

PHASE="preflight"
echo ""
echo "[PRE-FLIGHT] Local repo checks ..."
cd "$LOCAL_REPO"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then
    fail 2 "not on main branch (currently on '$BRANCH')"
fi
echo "  branch:        main ✓"

if ! git diff --quiet || ! git diff --cached --quiet; then
    fail 3 "working tree is dirty (uncommitted changes). Commit or stash first."
fi
if [ -n "$(git status --porcelain)" ]; then
    fail 3 "working tree has untracked files. Commit, .gitignore, or stash."
fi
echo "  working tree:  clean ✓"

# Fetch origin/main so divergence check is against current truth.
git fetch origin main --quiet

LOCAL_SHA="$(git rev-parse HEAD)"
ORIGIN_SHA="$(git rev-parse origin/main)"
AHEAD="$(git rev-list --count origin/main..HEAD)"
BEHIND="$(git rev-list --count HEAD..origin/main)"

echo "  HEAD:          $LOCAL_SHA"
echo "  origin/main:   $ORIGIN_SHA"
echo "  ahead:         $AHEAD"
echo "  behind:        $BEHIND"

if [ "$AHEAD" -gt 0 ] || [ "$BEHIND" -gt 0 ]; then
    if [ $ALLOW_DIVERGENT -eq 1 ]; then
        echo ""
        echo "  !! DANGER: --allow-divergent set; bypassing divergence check"
        echo "  !! AHEAD=$AHEAD, BEHIND=$BEHIND — origin will not match what is deployed"
        echo "  !! Acceptable only when origin is unreachable AND deploy must ship now"
        echo ""
        if [ $YES -eq 1 ]; then
            echo "  NOTE: --yes does NOT auto-confirm --allow-divergent"
        fi
        read -r -p "  Type exactly 'YES I UNDERSTAND' to proceed: " confirm
        [ "$confirm" = "YES I UNDERSTAND" ] || fail 1 "divergence confirmation not received"
    else
        if [ "$AHEAD" -gt 0 ]; then
            fail 4 "local is $AHEAD ahead of origin/main. Push first, or use --allow-divergent."
        fi
        if [ "$BEHIND" -gt 0 ]; then
            fail 5 "local is $BEHIND behind origin/main. Pull/rebase first, or use --allow-divergent."
        fi
    fi
else
    echo "  divergence:    none ✓"
fi

# ============================================================================
# Phase 2 — SSH connectivity + current droplet state
# ============================================================================

PHASE="ssh-check"
echo ""
echo "[PRE-FLIGHT] SSH connectivity ..."
if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$DROPLET" 'true' 2>/dev/null; then
    fail 6 "cannot ssh to $DROPLET (key auth failed or host unreachable)"
fi
echo "  $DROPLET: reachable ✓"

CUR_BUILD_ID="$(ssh "$DROPLET" 'cat /opt/knuco/.next/BUILD_ID 2>/dev/null || echo unknown')"
CUR_DEPLOY_SHA="$(ssh "$DROPLET" 'cat /opt/knuco/.deploy-sha 2>/dev/null || echo unknown')"
CUR_PID="$(ssh "$DROPLET" 'systemctl show knuco -p MainPID --value 2>/dev/null || echo unknown')"
echo "  current BUILD_ID:    $CUR_BUILD_ID"
echo "  current deploy SHA:  $CUR_DEPLOY_SHA"
echo "  current PID:         $CUR_PID"

# ============================================================================
# Phase 3 — Pending migrations preview
# ============================================================================

PHASE="migrate-preview"
echo ""
echo "[PRE-FLIGHT] Pending migrations preview ..."
MIGRATE_STATUS_OUT="$(ssh "$DROPLET" "cd $REMOTE_APP && set -a && . /etc/knuco/env && set +a && npx prisma migrate status 2>&1" || true)"
PENDING_LIST="$(echo "$MIGRATE_STATUS_OUT" | awk '
    /Following migrations have not yet been applied:/ { capture=1; next }
    /^To apply migrations/ { capture=0 }
    capture && /^[0-9]/ { print "    - " $0 }
')"
PENDING_COUNT=$(echo -n "$PENDING_LIST" | grep -c '^' || true)

# ============================================================================
# Phase 4 — Deploy plan
# ============================================================================

echo ""
echo "================================================================"
echo "DEPLOY PLAN"
echo "================================================================"
echo "  From:  $(git log -1 --format='%h %s')"
echo "  To:    $DROPLET:$REMOTE_APP (via rsync)"
echo "  URL:   $PUBLIC_URL"
echo ""
if [ -z "$PENDING_LIST" ]; then
    echo "  MIGRATIONS TO APPLY: none"
else
    echo "  PENDING MIGRATIONS TO APPLY: $PENDING_COUNT"
    echo "$PENDING_LIST"
    echo ""
    echo "  Migrations will apply BEFORE build. If any migration fails, deploy halts"
    echo "  and the pre-deploy DB backup is the rollback target."
fi
echo ""
echo "  Pre-deploy artifacts created on droplet:"
echo "    - DB dump in $REMOTE_BACKUP_DIR"
echo "    - /opt/knuco tarball as pre-deploy-${TS}.tar.gz"
echo "  Old tarballs trimmed to keep newest $TARBALL_RETENTION."
echo "================================================================"

if [ $DRY_RUN -eq 1 ]; then
    echo ""
    echo "DRY RUN: exiting without making any changes."
    DEPLOY_OK=1
    exit 0
fi

if [ $YES -eq 0 ]; then
    echo ""
    read -r -p "Proceed with deploy? (y/N) " ans
    case "$ans" in
        y|Y|yes|YES) ;;
        *) echo "Aborted by operator."; DEPLOY_OK=1; exit 0 ;;
    esac
fi

# ============================================================================
# Phase 5 — Pre-deploy backup + tarball
# ============================================================================

PHASE="backup"
echo ""
echo "[BACKUP] Running nightly DB backup script ..."
ssh "$DROPLET" 'sudo /usr/local/bin/knuco-backup.sh' || fail 7 "DB backup script failed"
BACKUP_FILE="$(ssh "$DROPLET" "ls -1t $REMOTE_BACKUP_DIR/postgres-*.dump | head -1")"
BACKUP_SIZE="$(ssh "$DROPLET" "stat -c%s $BACKUP_FILE")"
if [ "$BACKUP_SIZE" -lt 10240 ]; then
    fail 8 "DB backup $BACKUP_FILE is suspiciously small ($BACKUP_SIZE bytes < 10K)"
fi
echo "  backup: $BACKUP_FILE ($BACKUP_SIZE bytes) ✓"

PHASE="tarball"
echo ""
echo "[BACKUP] Creating pre-deploy /opt/knuco tarball ..."
TARBALL_FILE="${REMOTE_BACKUP_DIR}/pre-deploy-${TS}.tar.gz"
ssh "$DROPLET" "sudo tar czf $TARBALL_FILE \
    --exclude=node_modules --exclude=.next --exclude=src/generated/prisma \
    -C /opt knuco" || fail 9 "tarball creation failed"
TARBALL_SIZE="$(ssh "$DROPLET" "stat -c%s $TARBALL_FILE")"
echo "  tarball: $TARBALL_FILE ($TARBALL_SIZE bytes) ✓"

# Trim old tarballs: keep newest $TARBALL_RETENTION (current included).
ssh "$DROPLET" "ls -1t $REMOTE_BACKUP_DIR/pre-deploy-*.tar.gz 2>/dev/null | tail -n +$((TARBALL_RETENTION + 1)) | xargs -r sudo rm -f" || true

# ============================================================================
# Phase 6 — rsync code
# ============================================================================

PHASE="rsync"
echo ""
echo "[DEPLOY] rsync $LOCAL_REPO → $DROPLET:$REMOTE_APP ..."
rsync -az --delete \
    --exclude=.git/ --exclude=node_modules/ --exclude=.next/ \
    --exclude=dist/ --exclude=build/ '--exclude=.env*' \
    --exclude=.DS_Store '--exclude=*.log' \
    --exclude=src/generated/prisma/ \
    --exclude=DISCOVERY.md --exclude=MIGRATION_LOG.md --exclude=MIGRATION_PLAN.md \
    --exclude=__pycache__/ '--exclude=*.tsbuildinfo' --exclude=next-env.d.ts \
    -e ssh "$LOCAL_REPO/" "$DROPLET:$REMOTE_APP/" \
    || fail 10 "rsync failed"
RSYNC_DONE=1
echo "  rsync: ok ✓"

# ============================================================================
# Phase 7 — Remote install + migrate + build
# ============================================================================

PHASE="install-and-build"
echo ""
echo "[DEPLOY] Install + migrate + build on droplet ..."
REMOTE_RC=0
ssh "$DROPLET" bash <<'REMOTE' || REMOTE_RC=$?
set -euo pipefail
cd /opt/knuco
set -a; . /etc/knuco/env; set +a

echo "--- npm ci --include=dev ---"
npm ci --include=dev

echo "--- npx prisma generate ---"
npx prisma generate

echo "--- npx prisma migrate status (pre-deploy, informational) ---"
npx prisma migrate status || true

echo "--- npx prisma migrate deploy ---"
npx prisma migrate deploy

echo "--- npm run build ---"
npm run build

echo "--- npx prisma migrate status (post-deploy, strict) ---"
POST_STATUS="$(npx prisma migrate status 2>&1)"
echo "$POST_STATUS"
if ! echo "$POST_STATUS" | grep -q "Database schema is up to date!"; then
    echo "ERROR: post-deploy migrate status did not report up-to-date"
    exit 1
fi

echo "--- new BUILD_ID ---"
cat /opt/knuco/.next/BUILD_ID
REMOTE

if [ $REMOTE_RC -ne 0 ]; then
    fail 14 "remote install/migrate/build chain failed (rc=$REMOTE_RC) — see log above"
fi
MIGRATE_DEPLOY_DONE=1
BUILD_DONE=1

# ============================================================================
# Phase 8 — Restart service
# ============================================================================

PHASE="restart"
echo ""
echo "[DEPLOY] Restarting knuco.service ..."
ssh "$DROPLET" 'sudo systemctl restart knuco' || fail 16 "systemctl restart failed"

ACTIVE_OK=0
STATE=""
for i in $(seq 1 30); do
    STATE="$(ssh "$DROPLET" 'systemctl is-active knuco' 2>&1 || true)"
    if [ "$STATE" = "active" ]; then
        echo "  active after ${i}s ✓"
        ACTIVE_OK=1
        break
    fi
    sleep 1
done
if [ $ACTIVE_OK -eq 0 ]; then
    fail 17 "knuco.service did not become active within 30s (last state: $STATE)"
fi
RESTART_DONE=1

NEW_PID="$(ssh "$DROPLET" 'systemctl show knuco -p MainPID --value')"
NEW_BUILD_ID="$(ssh "$DROPLET" 'cat /opt/knuco/.next/BUILD_ID')"
echo "  new PID:        $NEW_PID"
echo "  new BUILD_ID:   $NEW_BUILD_ID"

# ============================================================================
# Phase 9 — Smoke tests
# ============================================================================

PHASE="smoke-droplet"
echo ""
echo "[SMOKE] droplet curl $LOCAL_PORT_URL ..."
DROPLET_HTTP="$(ssh "$DROPLET" "curl -sI --max-time 5 -o /dev/null -w '%{http_code}' $LOCAL_PORT_URL")"
case "$DROPLET_HTTP" in
    200|307) echo "  HTTP $DROPLET_HTTP ✓" ;;
    *) fail 18 "droplet-side curl returned HTTP $DROPLET_HTTP (expected 200 or 307)" ;;
esac

PHASE="smoke-laptop"
echo ""
echo "[SMOKE] laptop curl $PUBLIC_URL ..."
LAPTOP_HTTP="$(curl -sI --max-time 10 -o /dev/null -w '%{http_code}' $PUBLIC_URL)"
case "$LAPTOP_HTTP" in
    200|307) echo "  HTTP $LAPTOP_HTTP ✓" ;;
    *) fail 19 "laptop-side curl returned HTTP $LAPTOP_HTTP (expected 200 or 307)" ;;
esac

PHASE="smoke-journal"
echo ""
echo "[SMOKE] journal scan for errors since restart ..."
JOURNAL_BAD="$(ssh "$DROPLET" "sudo journalctl -u knuco --since '2 minutes ago' --no-pager" \
    | grep -iE 'error|fatal|throw|PrismaClientInitialization|ECONNREFUSED|ZodError' \
    | grep -vE 'status=143|Failed with result .exit-code.|Main process exited, code=exited, status=143' \
    || true)"
if [ -n "$JOURNAL_BAD" ]; then
    echo "$JOURNAL_BAD"
    fail 20 "journal contained error patterns after restart"
fi
echo "  no error patterns found ✓"

# ============================================================================
# Phase 10 — Record deploy SHA
# ============================================================================

PHASE="record-sha"
ssh "$DROPLET" "echo $LOCAL_SHA | sudo tee $REMOTE_APP/.deploy-sha >/dev/null && sudo chown knuco:knuco $REMOTE_APP/.deploy-sha"
echo ""
echo "  /opt/knuco/.deploy-sha: $LOCAL_SHA ✓"

# ============================================================================
# Done
# ============================================================================

PHASE="complete"
DEPLOY_OK=1
echo ""
echo "================================================================"
echo "DEPLOY SUCCESS"
echo "  HEAD:        $LOCAL_SHA"
echo "  BUILD_ID:    $CUR_BUILD_ID → $NEW_BUILD_ID"
echo "  PID:         $CUR_PID → $NEW_PID"
echo "  Tarball:     $TARBALL_FILE"
echo "  DB backup:   $BACKUP_FILE"
echo "  URL:         $PUBLIC_URL"
echo "================================================================"
