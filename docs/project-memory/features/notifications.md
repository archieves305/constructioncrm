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

Still legacy in Stage 1 (folded in Stage 2): the morning task digest,
escalations, violation deadline reminders/escalations, field-log digest and
draft reminders.

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

## Stage log

- **Stage 1 (2026-09-27, `notifications` branch):** schema + migration,
  service layer, producers rewired with legacy fallback, bell + center on
  the new table, tick (retry + dry run), preference mirroring. 989 tests
  (+57), lint 6/22, typecheck + build clean.
