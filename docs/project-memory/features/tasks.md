# Feature — Tasks (the work queue)

_Collaboration layer deployed 2026-08-03 (`d12945e`). "Tasks everywhere"
(Stage 1 of 3) deployed 2026-09-24 (`d7262d0`, `ebf1988`). Stage 2 = email follow-up (escalation,
nudge, auto-tasks, reminders); Stage 3 = visual redesign (boards, job flow)._

## Why

Richard wants tasks to be the spine of the CRM: anyone can assign work to
anyone, see it through, be followed up by email, and reach a task from the
record it is about. Before Stage 1 a task could only hang off a lead or a
job, five code paths created tasks silently (no timeline row, no assignment
email), the lead and job pages had a crude or read-only Tasks tab, and there
was nothing on invoices, estimates, daily logs, prospects, the dashboard,
the sidebar or in field mode beyond a single email-destination page.

## Shape

**Server — one way in, one way through.** Every task is created by
`createTask()` in `src/lib/tasks/create.ts` and changed by `updateTask()` in
`src/lib/tasks/update.ts`. The API, the deposit task on job creation, stage
templates, follow-up rules and field issues all go through `createTask`,
which writes CREATED (`toValue` = source) / ASSIGNED / WATCHER_ADDED events
through the same Prisma client as the row, derives the parent link
(invoice/daily log → job, estimate/prospect → lead), and mails the assignee
via `runAfterResponse` (`after()` in a request, inline fallback otherwise).
Resolving a field issue now completes its task through `updateTask`, so the
task gets a STATUS_CHANGED row and the completion email; completing the task
resolves the issue in turn (guarded against ping-pong).

**Links.** `Task.estimateId` (template `Estimate`, the one with a status),
`invoiceId`, `prospectId`, `dailyLogId` — nullable FKs, `SetNull`, indexed,
migration `20260924120000_task_entity_links`. A finer link always also
carries its parent `jobId`/`leadId`, so visibility, counts and email context
keep working unchanged. Also added the missing indexes on `leadId`/`jobId`.

**Open means PENDING, IN_PROGRESS or BLOCKED** — `OPEN_TASK_STATUSES` in
`src/lib/tasks/status.ts`. The dashboard KPI and the jobs/leads list chips
had drifted to PENDING/IN_PROGRESS only; fixed by using the constant.

**Query.** `buildTaskListWhere()` in `src/lib/tasks/query.ts` translates
`GET /api/tasks` params (all six link ids, `assignedUserId=me`,
`overdue=1|true`, `includeCompleted`) and always ANDs
`taskVisibilityFilter`. Entity panels read through this route, never the
parent's unscoped `tasks` include, which is what keeps a SALES_REP on a job
page to their own rows. `GET /api/tasks/summary` → `{ open, overdue,
dueToday, blocked }` for the session user (sidebar badge, field nav).
`GET /api/users/assignable` — active users, any signed-in role. The old
`/api/admin/users` is ADMIN/MANAGER only, which had been silently breaking
every assignee picker for office staff and reps.

**Client — `src/components/tasks/`.** `use-tasks.ts` (react-query hooks,
`taskKeys`, one invalidation fan-out), `task-colors.ts` (the single
status/priority palette), `types.ts`, `add-task-dialog.tsx` (context chip,
priority chips, due presets, assignee picker with avatars, watchers, ⌘↵),
`entity-task-panel.tsx` (the per-record list + "Add task"), `task-card.tsx`
(lifted from the tasks page), `task-entity-chip.tsx` (most-specific link),
`task-count-badge.tsx`, `my-tasks-widget.tsx`,
`shared/user-avatar.tsx`.

**Where tasks now appear.** Lead detail and job detail Tasks tabs
(`EntityTaskPanel`, counts scoped), invoice rows and template-estimate rows
(count badge + add button), the office daily-log page ("Office follow-ups",
field-issue tasks land here via the `dailyLogId` backfill), prospect cards,
dashboard (`MyTasksWidget`; the Overdue KPI links to `/tasks?overdue=1`),
sidebar badge (overdue in red, else open count), field mode (`/field/tasks`
index, `FieldBottomNav` on `/field` and `/field/tasks*` only — the daily-log
page owns its own bottom bar — and task chips on job cards).

## Rules

- Only `createTask` creates a task; only `updateTask` changes one. A new
  automation that needs a task calls `createTask` with a `source`.
- Any code that counts or lists "open" tasks uses `OPEN_TASK_STATUSES`.
- Entity panels filter through `/api/tasks`, never a parent include.
- `after()` inside a `$transaction` is safe: `notifyTaskAssigned` re-reads
  the task and sends nothing if the transaction rolled back.
- Query keys: keep the `"tasks-v2"` prefix; `useInvalidateTasks()` is the
  fan-out.

## Tests

`src/lib/tasks/{create,update,summary,query}.test.ts` plus the existing
access/events/mentions/recipients/task-email/validator suites.
`follow-ups/processor.test.ts` mocks `@/lib/tasks/create`.

## Stage 2 — email follow-up (deployed 2026-09-24, `4b6021d`)

Migration `20260924130000_task_followups`: `Task.sourceKey` (automation
key, indexed, NOT unique), `escalationLevel` / `lastEscalatedAt`,
`remindAt` / `remindedAt` / `remindSetByUserId`; `User.escalationEmailsEnabled`
/ `reminderDigestEnabled` / `nudgeEmailsEnabled`; `TaskEventType` +NUDGED,
ESCALATED, REMINDER_SET, REMINDER_SENT, AUTO_CLOSED.

- **Channels.** `resolveRecipients({ channel })` — `task` is the master
  switch, `escalation` / `reminder` / `nudge` sit under it; skip reason
  `channel-muted`. Toggles at `/settings/notifications` (sidebar footer gear)
  via `/api/me/preferences`.
- **Nudge.** `POST /api/tasks/[id]/nudge` `{ message? }` — office roles or
  the raiser (`canNudgeTask`); 400 without an assignee or when you are the
  assignee, 409 closed, 429 inside the 24h cooldown (ledger = latest
  `NUDGED` row; `lib/tasks/nudge-policy.ts` is shared with the sheet button).
  Response says `willEmail` so the UI can toast "recorded, but muted".
- **Reminders.** `remindAt` on create and PATCH (date-only, pinned to noon
  UTC); setting re-arms (`remindedAt = null`), records `REMINDER_SET`.
  Delivered by `runMorningDigest` (`lib/tasks/reminders.ts`) as a
  "Reminders" section of the digest to the assignee (or creator when
  unassigned) plus the setter when different; only the primary copy retires
  it. `planDigest` is pure and tested.
- **Escalation.** `lib/tasks/escalations.ts`: `TASK_ESCALATION_DAYS`
  (default `2,5`) → level 1 mails the raiser (skipped when raiser ==
  assignee), level 2 adds ADMIN/MANAGER. One grouped mail per person. Ledger
  advances only for tasks somebody was actually told about; a jump 0→2 is one
  mail; a new due date resets to 0 (`updateTask`). **Off unless
  `TASK_ESCALATIONS_ENABLED=1`** — set it after the SPF record exists.
- **Auto-tasks.** `lib/tasks/auto-tasks.ts` — `ensureAutoTask(source,
  actor)` (idempotent on an OPEN `sourceKey`; disabled kinds via
  `TASK_AUTO_RULES_DISABLED`, default `invoice.sent`) and `closeAutoTask(key,
  { outcome, because })` → `AUTO_CLOSED`. Hooks, all post-commit:
  estimate PUT (`onEstimateTransition`: SENT raises + advances
  `Lead.nextFollowUpAt`, ACCEPTED completes, DECLINED cancels); invoice PATCH
  + `syncInvoiceStatus` (now returns the transition) via
  `onInvoiceTransition` (SENT raises, PAID completes, VOID cancels) from
  `recordPayment`, `payments/[id]`, progress-billing `createApplication`
  when SENT, and change-order approval (which also completes the CO task);
  CO send raises, reject/delete cancel; daily-log return raises HIGH to the
  submitter (captured before the update nulls it), resubmit completes.
- **Cron.** `POST /api/cron/task-reminders` = digest pass then escalation
  pass, each fenced; `requireCronSecret()` in `lib/cron/auth.ts` now gates
  all eight cron routes. No droplet change. Response keeps the top-level
  `tasks/people/sent/failures` keys.

## Not yet

Stage 3 (kanban kit, stage colours, job detail header/stepper/tab groups,
list polish) is next. `RoofEstimate` has no status and is not linkable.
The FollowUpRule engine still exists alongside auto-tasks; nothing was
migrated off it.
