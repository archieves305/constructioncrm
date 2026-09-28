# Notifications v2 — record, classify, deliver

_Plan: `~/.claude/plans/quirky-pondering-mccarthy.md` (approved 2026-09-27). Four
stages; Stage 1 built 2026-09-27 on the `notifications` branch._

## Why

The workflow engine made every task event an email: a step completion mailed
the assignee, the applier (as `createdByUserId` of every step) and the
watchers, then one "Task assigned" per dependent step that became Ready;
setting a PM after apply mailed that PM once per open step, including steps
not yet active. Users were learning to ignore CRM mail. The goal is
**fewer emails, better emails, no missed critical information**: routine
activity folds into ~4 digests per business day, urgent events still go now,
and one record powers both the bell and email.

## Shape

```
event → notify() → one Notification row per recipient (the bell)
                 → classify(): IMMEDIATE | DIGEST | IN_APP_ONLY | NONE
                 → IMMEDIATE sends now with the caller's renderer
                   DIGEST waits for its window (scheduledWindowKey)
                   IN_APP_ONLY just exists
POST /api/cron/notifications (every 10 min) → retries, digest windows (Stage 2)
```

- `src/lib/notifications/kinds.ts` — the registry. `kind` is a **string**
  validated here (adding one is a line, not a migration); each has a
  category (mutable by users), a digest section, a default class, an
  optional `immediateWhen` upgrade rule, `neverDemote`, `collapsible`,
  `actionRequired`.
- `classify.ts` — pure. Order: forced → registry NONE → actor receipt →
  admin `immediateKinds` / `digestOnlyKinds` → default + upgrade → user
  mode / muted category → batch / hourly cap / storm demotion (recorded on
  the row as `demotedFrom` + `demotedReason`). Mentions, nudges,
  escalations and emergency cases are never demoted.
- `notify.ts` — the one entry point. `resolveRecipients({includeMuted})`,
  classify per recipient, **upsert on `[recipientUserId, dedupeKey]`**
  (`<kind>:<subjectType>:<subjectId>:<bucket>`, bucket = the digest window
  key, the local hour for IMMEDIATE, the local day for IN_APP_ONLY) so a
  repeat bumps `occurrences` and un-reads the row, `TaskEvent NOTIFIED` per
  new row on task subjects, `deliverImmediate()` when v2 owns delivery.
  Never throws; on any failure it returns `legacy: true` so the caller
  mails the way it always did.
- `windows.ts` — DST-safe window arithmetic on `nurture/time.ts`. Keys are
  `YYYY-MM-DD:HH:MM` in the company time zone and sort in time order, so
  the tick selects "pending rows for this window or earlier" with one `<=`.
  `nextWindow` respects the person's `digestWindows` subset (empty = all).
- `settings.ts` — `NotificationSettings` singleton (id `default`, 60 s
  cache), the two gates: env `NOTIFICATIONS_V2` (recording) and
  `settings.enabled` (delivery takeover).
- `storm.ts` — per-user IMMEDIATE count in the last hour (one `groupBy`),
  global count in the last 10 min; a storm logs `NOTIFICATION_STORM`,
  audits `NotificationStorm:<hour>` once, and mails ops via
  `sendOpsEmail` (extracted from `delivery-report.ts`).
- `digest/run.ts` — the tick. Stage 1: retry stuck / failed IMMEDIATE rows
  (≤ 3 attempts, generic single-item mail) and report the per-person plan
  for the due window. Digest build + send is Stage 2.
- `links.ts` — rows store office paths; `hrefForRole` maps CREW_LEAD to
  `/field/...` at render time. `filters.ts` — the center's tabs.

## Gates and modes

| env `NOTIFICATIONS_V2` | `settings.enabled` | Behaviour |
|---|---|---|
| `0` (default) | any | Nothing recorded; legacy mail exactly as before. |
| `1` | `false` | **Shadow**: rows recorded (`state SUPPRESSED`, `lastError "shadow: legacy path mailed"` for email classes), bell live, legacy mail unchanged. |
| `1` | `true` | v2 owns delivery: IMMEDIATE sends via the caller's renderer, DIGEST waits, legacy senders stand down. **Do not flip on prod before Stage 2** — nothing would send the digests. |

Rollback is `settings.enabled = false` (instant), then `NOTIFICATIONS_V2=0`.

## Producers (Stage 1)

| Producer | Kind(s) | Recipients | Batch key |
|---|---|---|---|
| `tasks/notify.ts notifyTaskAssigned` | `task.assigned` / `task.reassigned` / `task.ready` | assignee | from `createTask`/`updateTask` `notifyBatch` |
| `notifyTaskCompleted` | `task.completed` | assignee, watchers, raiser (manual tasks only), job PM / case manager as `owner`, actor as `actor` (bell receipt) | — |
| `notifyTaskBlocked` | `task.blocked` | same audience minus actor | — |
| `notifyTaskMentions` / `notifyTaskNudged` | `task.mentioned` / `task.nudged` | mentioned / assignee | — |
| `workflows/notify.ts notifyTasksReady(ids, actor, batchKey)` | `task.ready` | assignee per step | `wf-apply:<inst>:<ts>`, `wf-activate:<closedTaskId>`, `wf-sweep:<inst>:<ts>` |
| `workflows/roles.ts reassignUnresolved` | `task.assigned` via `updateTask` | **active** steps only (inactive get `notify:"none"`; activation tells them later) | `wf-reassign:<inst>:<ts>` |
| `services/jobs.ts spawnTasksFromTemplates` | `task.assigned` | template assignee | `stage:<jobId>:<stageId>:<ts>` |
| `violations/notify.ts` | `case.assigned`, `case.item_assigned`, `case.inspection_scheduled`, `case.agency_confirmed`, `case.closed` | as before; job PM is `owner` | — |
| `customer-contracts/email.ts notifyContractOutcome` | `contract.outcome` | sender + creator (userIds) | — |
| `follow-ups/processor.ts` IN_APP branch, `alert-service.ts` | `lead.follow_up`, `lead.new` | assigned rep, forced IN_APP_ONLY | — |

Behaviour changes when v2 delivers: the applier no longer hears every step
completion (the PM does, grouped); the completer gets a bell receipt, not a
mail; role back-fill no longer mails inactive steps; `WORKFLOW_READY_EMAILS_ENABLED`
only gates the legacy per-step mail.

Stage 2 folded the morning task digest (overdue / due today / reminders /
schedule changes / job starts) into the first window and retired
`WORKFLOW_READY_EMAILS_ENABLED`. Still legacy (Stage 4): task escalations,
violation deadline reminders / escalations, field-log digest and draft
reminders — they keep their own crontab lines and mail.

## Digests (Stage 2, built 2026-09-28)

```
tick (every 10 min) → dueWindow? → for each person with pending rows
  (morning: everyone with email who is not in-app-only)
  ledger NotificationDigest {person, window}   ← unique: one digest per window
  → claim: updateMany PENDING rows ≤ window → CLAIMED + digestId   ← atomic
  → permissions.ts re-check (SUPPRESSED rows never render)
  → digest/build.ts (pure) → digest/agenda.ts → digest/render.ts (pure)
  → sendEmail → SENT (+ rows SENT/emailedAt, EMAIL_SENT once per task,
    reminders retired)   |   failure → FAILED, rows released (never lost)
```

- **`digest/build.ts`** (pure, tested): dedupe the same event on the same
  subject (newest wins, occurrences summed); on one task `task.completed`
  supersedes assigned / reassigned / ready / blocked and `task.reassigned`
  supersedes assigned; rows of a collapsible kind sharing a `batchKey`, in
  the same section and subject, ≥ `batchCollapseThreshold` (3) → one line
  ("5 workflow steps became ready", first three titles, the subject's
  link); ACTION REQUIRED when the row is `actionRequired` and the person is
  assignee / mentioned / manager / owner, else the registry section; groups
  by job → case → lead → none (busiest / most urgent first); caps
  `digestMaxPerSubject` then `digestMaxPerSection` with "+N more" and the
  hidden rows still counted as delivered; CREW_LEAD drops JOB_UPDATES and
  COMPLETED; unknown kinds land in OTHER.
- **`digest/agenda.ts`**: the person's calendar through the very query the
  Day view and `/field/day` read (`users=me`, tasks + overlays via
  `lib/calendar/overlays-load.ts`). Morning = today + overdue (30-day
  look-back) + due custom reminders + "Schedule changed since yesterday" +
  "Starting today"; midday / afternoon = the rest of today; evening =
  tomorrow. Null when empty. Reminders it carries are retired
  (`remindedAt`, `REMINDER_SENT`) after the send.
- **`digest/render.ts`** (pure, tested): subject ≤ 78 chars — one action →
  "Blocked: Permit gate at 7676 Peters Road — Midday digest"; several →
  "3 to action · 12 updates — …"; updates only → "12 updates on your jobs";
  agenda only → "Your morning: 3 scheduled"; never "new notifications".
  Body: Starting today → agenda → sections in registry order → "N more in
  the CRM" → **View all activity** (`/notifications?since=<last digest>`).
  Links resolve per role (`hrefForRole`: CREW_LEAD → `/field/...`).
- **`permissions.ts`**: `visibleSetsFor` — view-all roles pass; otherwise
  one `visibilityScopeFor` + one query each for tasks (`canViewTask`),
  cases (`violationVisibilityFilter`), jobs and leads (involvement); pure
  `splitVisible` checks the finest subject set on the row.
- **`digest/run.ts`**: shadow → report per person (PENDING + SUPPRESSED
  rows ≤ window); takeover → `recoverStaleDigests` (SENDING > 15 min →
  FAILED, rows released, audit `stale_recovery`), then per person: a
  window the person's `digestWindows` skip → rows re-stamped to their
  `nextWindow`, ledger SKIPPED_MUTED; ledger create (P2002 → SENT /
  SKIPPED → "already"; FAILED < 3 attempts → retry; SENDING → another tick
  has it); claim; filter; build; agenda; empty → SKIPPED_EMPTY with rows
  SENT (bell only); else SENDING (attempts+1) → send → SENT with counts →
  rows SENT + `providerMessageId` → receipts; failure → FAILED + rows
  PENDING again. `lastMorningProducedOn` ledger on the first window;
  `prune` on the last (rows SENT/SUPPRESSED and finished digests older than
  `retentionDays`). `?dryRun=1` builds every model, claims nothing, and
  reports subject / items / agenda / suppressed per person.
- **Legacy stand-down**: `runMorningDigest` returns `skipped` under
  takeover (the crontab line stays until Stage 4 and is a no-op).
- **Admin → Notification Digests** (`/admin/notifications`, sidebar under
  Automation; view ADMIN + MANAGER, manage ADMIN): status strip (off /
  shadow / delivering, due + next window, 7-day counts); Delivery (the
  switch, windows, zone, weekdays, grace, retention, the caps) with
  **Preview the next digest** (dry run) and **Run the tick now**;
  Immediate rules (always / never per kind, `neverDemote` kinds locked);
  Log (digests with counts and errors, last immediate rows with their
  classify reason). Routes: `GET/PUT /api/admin/notifications/settings`,
  `GET …/log`, `POST …/tick?dryRun=1|0`. Validator
  `lib/validators/notifications.ts`.

## Preferences

`User.notificationEmailMode` (DIGEST default | IMMEDIATE = legacy
one-per-event, opt-in | IN_APP_ONLY), `digestWindows` (subset of the admin
windows, empty = all), `mutedCategories`. The migration backfilled them from
the four legacy booleans; `PATCH /api/me/preferences` mirrors the legacy
switches onto them (`mirrorLegacyPrefs`) until the settings page writes them
directly (Stage 3). The legacy booleans are dropped in Stage 4.

## Bell and center

`GET /api/notifications?filter=all|action|mentions|tasks|jobs&unread&since&cursor&limit`
reads the new table (role-resolved `href`), `GET /api/notifications/unread-count`
for the badge, `POST .../[id]/read`, `read-all`. `NotificationBell` (All /
Action chips, click = mark read + navigate) and `/notifications` (tabs,
`?since=` for the digest's "View all activity", load more). The old
`NotificationEvent` table stays the lead SMS/email send log; its unread
IN_APP rows were marked read by the migration.

## Schema (`20261006120000_notifications`)

`Notification` (typed FKs to task/job/lead/case with cascade, `subjectType`
+ `subjectId` for finer subjects, `signals` JSON, `batchKey`, `dedupeKey`
unique per recipient, `deliveryClass` + `classifyReason` + demotion,
`scheduledWindowKey`, `state`, `digestId`, `attempts`, `emailedAt`,
`providerMessageId`, `readAt`), `NotificationDigest` (unique
`[recipientUserId, windowKey]`, counts, status), `NotificationSettings`
(windows, tz, caps, overrides, retention, `lastMorningProducedOn`), the
three User columns, `TaskEventType.NOTIFIED`. The migration was generated
against the dev DB and hand-trimmed: the dev DB carried another session's
uncommitted calendar columns, and the enum change is a plain `ADD VALUE`.

## Operator notes

- Stage 1 on prod: deploy, then `NOTIFICATIONS_V2=1` in `/etc/knuco/env` +
  restart (shadow). Watch `notifications tick` lines and the bell.
- Tick by hand: `curl -s -X POST -H "x-cron-secret: $CRON_SECRET" "http://127.0.0.1:4000/api/cron/notifications?dryRun=1"`.
  The crontab line (`*/10 * * * 1-5 /home/knuco/crm-cron/notifications.sh`)
  goes in with Stage 2.

### Cron wrapper (droplet, user `knuco`)

`/home/knuco/crm-cron/notifications.sh`, mirroring the other wrappers:

```bash
#!/usr/bin/env bash
set -a; . /etc/knuco/env; set +a
out=$(curl -s -m 120 -X POST -H "x-cron-secret: $CRON_SECRET" "http://127.0.0.1:4000/api/cron/notifications")
echo "$(date -u +%FT%TZ) $out" >> /home/knuco/crm-cron/notifications.log
```

crontab line (every 10 minutes, every day — weekends are decided by the
settings, not the schedule): `*/10 * * * * /home/knuco/crm-cron/notifications.sh`.

## Stage log

- **Stage 1 (2026-09-27, `notifications` branch):** schema + migration,
  service layer, producers rewired with legacy fallback, bell + center on
  the new table, tick (retry + dry run), preference mirroring. 989 tests
  (+57), lint 6/22, typecheck + build clean.

**Stage 2 — 2026-09-28.** Built on the `notifications` worktree after
merging `main` (calendar phases). Dev QA `scratchpad/qa-digest.js` 16/16
on the worktree dev server (port 4001, `NOTIFICATIONS_V2=1`): switch on +
a window due now, five DIGEST rows (an assignment, a blocked gate, a
three-step engine batch) → dry run plans "Blocked: QA digest: permit gate
blocked — Midday digest", claims nothing → real run sends one digest (to
Richard, labelled QA), ledger SENT with 3 items / 3 collapsed and a
provider id, rows SENT with `emailedAt`, `EMAIL_SENT` once per task → a
second tick sends nothing → `task-reminders` cron answers `skipped` →
a digest left SENDING for 20 min is recovered (FAILED, rows PENDING) →
a person whose windows exclude the due one gets rows re-stamped to
tomorrow 08:00 and SKIPPED_MUTED → the admin log lists it → switch off
returns to shadow. Settings restored, QA rows deleted. Gate: typecheck
clean, lint 6/22, 1157 tests (+15), build clean. The QA fixture's first
run put three "ready" rows on one task and saw them dedupe to one line
before collapsing — correct behaviour, wrong fixture.

