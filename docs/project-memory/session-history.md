# Session History — KNU Construction CRM

_Detailed, append-only log. Newest first. Concise summary in `/CLAUDE.md` §4._

---



## 2026-09-24 — Trade Workflow Templates, Stage 3

New: `src/lib/jobs/query.ts` (+test) — `parseJobListParams`,
`buildJobListWhere`, `hasWorkflowFilter`; `src/lib/workflows/summary.ts`
(+test) — `summarizeInstance` pure, `loadJobWorkflowSummaries` three
queries per page; `src/lib/workflows/reports.ts` (+test) —
`durationStats`, `durationsByTrade/Phase`, `overdueByRole`,
`classifyDelayCause`, `stalledSteps`, `leadTimes`, `mostSkipped`,
`buildWorkflowReport`, `buildWorkflowHealth`, loaders;
`components/workflows/job-workflow-summary.tsx` (pill, chips, phase
cell); `components/dashboard/workflow-health-widget.tsx`;
`components/reports/workflow-report-section.tsx` (dataviz-skill rules:
one hue per measure, hairline solid grid, rounded bar ends, tooltip on
every mark, table under every chart; the two-series stalled chart uses
the validated slot-1/slot-2 pair with a legend). Changed: `/api/jobs`,
`/api/reports` (`workflow`, `workflow-health`), `/api/workflow-templates`
(`phases`), jobs page, production page + `JobBoardCard`, dashboard page,
reports page (also moved its two fetches onto `fetchJson`),
`workflows/access.ts` (`canViewWorkflowReports`, `workflowHealthScope`).

QA on dev: API probes for every filter and both report types; screenshots
of jobs, filtered jobs, board, dashboard and the Workflow section via
headless Chromium (`playwright-core` + the cached
`chromium_headless_shell-1228`, cookie via `addCookies`) because the
Chrome tool blocks `document.cookie`; as `john.rep` the report 403s and
the widget scopes to his one job. Lint stayed 6/29 (one new `_score`
warning fixed). 604 tests, build clean. Deployed `f332e26` (no
migration, build `W3SSiv0mXjZ3bx9g0kTOU`).

## 2026-09-24 — Trade Workflow Templates, Stage 2

`reconcile.ts` rewritten as the generic engine (`build` → `diff` →
apply; `ENGINE_SKIP_PREFIX` tells engine skips from a person's, only those
are reinstated); `apply.ts` gained the pure `diffEdges`; `inspections.ts`;
`versioning.ts` + `validate.ts`; failed-inspection reopen in
`activation.ts` gated on correction tasks only (QA caught that gating on
all predecessors left an out-of-order inspection blocked forever).
Routes: `…/workflow/reconcile{,/preview}`, `/api/tasks/[id]/inspection`,
`/api/tasks/[id]/dependencies`, admin template + version CRUD. UI:
`ReconcileDialog` (permit / add / remove / scope / upgrade) +
`ReconcilePreviewPanel`, `InspectionResultForm`, `DependencyEditor`,
`ui/sortable-list`, `TemplateEditor` + `TaskEditorSheet` +
`PhaseEditorDialog` + `ScopeTogglesEditor`, New template. Client bundles
import `lib/workflows/role-labels` and `slug`, never the Prisma-backed
modules. API QA on dev: permit flip both ways (8 added / 37 skipped, then
37 reinstated / 8 skipped), Core refusal, cycle message with titles,
draft → validate (cycle caught) → publish v2 → job upgrade adds the one
new step. 579 tests, lint 6/29. Deployed `5528cba` (no migration).

## 2026-09-24 — Trade Workflow Templates, Stage 1

Schema (`workflow_*`, `job_workflow_*`, `task_dependencies`, workflow
columns on `tasks`, `files.task_id`, `jobs.jurisdiction`), migration
`20261001120000_workflow_templates` with the `activated_at` backfill. DSL
(`defineTemplate`), pure `compose`/`dependencies`/`schedule`, `apply`
(idempotent `materializePlan`), `activation` inline from `updateTask`,
`evidence`, `roles`, `determinePermit`, `reconcileScope`. Four seeded v1
templates (34/74/85/81 steps). Routes under `/api/jobs/[id]/workflow`,
`/api/workflow-templates`, `/api/admin/workflow-role-defaults`. UI:
Workflow tab, Apply dialog, sheet block, filters, admin pages, post-Won
toast. Own-only visibility widened by job relationship. Two bugs found in
QA and fixed before deploy: a permit-conditioned mid-chain inspection was
dropped instead of bypassed when not required (orphaned the chain);
deciding the permit 500'd because the gate step's own checklist blocked
the engine's completion. 563 tests, lint 6/29. Deployed `2790b88`; prod
seeded (`npx tsx prisma/seed-workflows.ts`, idempotent second run).

## 2026-09-24 (later still) — Visual redesign (Stage 3 of 3)

See [features/design-system.md](features/design-system.md) for the shape
and the gotchas. Order of work: tokens + primitives (no page impact) →
kanban kit + `/production` + `/pipeline` → tasks board on the kit + tasks
header polish + brand sidebar → `EntityHeader` + `StageStepper` + grouped
job tabs, lead detail header → jobs and leads lists.

Found while doing it: the shadcn CLI (base-nova) added a bogus `cn` npm
dependency and imported `cn` from it — reverted; `next build` running
alongside `next dev` served a token-less stale CSS bundle until dev was
restarted; overriding `onKeyDown` on a dnd-kit draggable silently disables
keyboard drag (chained now); the old `/production` allow-list hid three
stages. Browser QA on dev: boards render with phase colours and aggregates,
keyboard drag moves a lead and back (mouse drag could not be exercised by
the automation tool), job detail deep-links to `?tab=money&sub=invoices`,
lists and lead detail render. Lint 6/29, 481/481 tests, typecheck/build
clean.

**Deployed** `e867c5e` at 13:33 ET, no migrations: BUILD_ID
`YehfWHd9zfW9-YxNcwwzN` → `JAfdl5DEJdIShaUiCFbG2`, smoke 307/307, clean
journal. Backups `pre-deploy-20260924-132922.tar.gz` /
`postgres-2026-09-24-172929.dump`.

---

## 2026-09-24 (later) — Task email follow-up (Stage 2 of 3)

Built straight after Stage 1 deployed. See
[features/tasks.md](features/tasks.md) § Stage 2 for the shape.

- `lib/cron/auth.ts` `requireCronSecret()` replaces the block copy-pasted
  into eight cron routes (mechanical, regex-verified one replacement each).
- `resolveRecipients` grew a `channel`; three new `User` toggles and a
  `/settings/notifications` page (gear in the sidebar footer).
- Nudge: route + policy + sheet button with the same cooldown rule on both
  sides; the route records the NUDGED row synchronously so a double-click
  cannot pass the check twice, and answers `willEmail`.
- Reminders: digest logic moved out of the route into
  `lib/tasks/reminders.ts` with a pure `planDigest`; custom reminders ride
  the same morning mail.
- Escalations: pure planner, ledger on the task, off by default in env.
- Auto-tasks: typed rules, idempotent on an OPEN `sourceKey`; hooks at the
  estimate PUT (status is set through the editor save, not a status PATCH),
  invoice PATCH, `syncInvoiceStatus` (now returns its transition so callers
  react post-commit), progress-billing SENT applications, change-order
  send/approve/reject/delete, daily-log return/submit. `Lead.nextFollowUpAt`
  is advanced by an estimate follow-up — the first thing in the CRM that
  ever writes it from a task.
- New event rows on the timeline: NUDGED (violet), ESCALATED (red),
  REMINDER_SET/SENT (grey), AUTO_CLOSED (green).

Tests: 49 new (cron auth, recipient channels, nudge policy, due dates,
escalation planner + audience, digest planner, auto-tasks, email renderers,
create/update reminder + escalation reset). 476/476, typecheck/build clean,
lint 6/28.

API QA on dev with `TASK_ESCALATIONS_ENABLED=1`: nudge 200 → 429 with the
friendly cooldown message; reminder set; cron run 1 escalated two overdue
tasks and delivered the digest, run 2 escalated nothing (ledger); timeline
showed NUDGED / REMINDER_SET / ESCALATED; sheet rendered the nudge button
(greyed in cooldown) and the reminder field. Found while doing it: the
interactive dispatch dropped a provider response with no message id on the
floor — now recorded as EMAIL_FAILED like the cron path.

**Deployed** `4b6021d` at 13:10 ET: migration applied, BUILD_ID
`TIVSTNlHVR4hHEDg5rmdU` → `YehfWHd9zfW9-YxNcwwzN`, smoke 307/307, clean
journal. Backups `pre-deploy-20260924-130637.tar.gz` /
`postgres-2026-09-24-170644.dump`. Escalations off in prod by default.

---

## 2026-09-24 — Tasks everywhere (Stage 1 of 3)

Plan agreed with Richard: tasks are the spine of the CRM. Three stages, each
deployed and QA'd before the next — (1) tasks everywhere, (2) email
follow-up (overdue escalation, nudge, auto follow-up tasks, per-task
reminders), (3) visual redesign (kanban kit, stage colours, job detail
header/stepper/tab groups, list polish). Full plan in the session plan file;
feature notes in [features/tasks.md](features/tasks.md).

### Found while reading

- **Five creators bypassed the timeline and assignment email**: deposit task
  on job creation, stage templates, follow-up rules, field issues, plus the
  API was the only one writing CREATED. Field-issue *resolution* flipped the
  task to COMPLETED with a bare update — no event, no completion mail.
- **BLOCKED was dropped from three "open" counts** (dashboard KPI, jobs-list
  chip, leads-list chip) while the tasks page and cron counted it. A blocked
  overdue task vanished from every summary.
- **Every assignee picker 403'd for non-admins**: they all fetched
  `/api/admin/users`, which is ADMIN/MANAGER only. For OFFICE_STAFF and
  SALES_REP the dropdowns were silently empty (or, with raw `fetch`, the
  page would throw on `.filter`).
- The CLAUDE.md §4 header said the 2026-08-03 task work was "NOT deployed";
  it shipped as `d12945e` the same day. Corrected.
- Two docs disagreed on whether the task-reminders cron is enabled; the
  later "MailerSend upgraded" note (re-enabled, `30 11 * * 1-5`) wins.

### Built

Server: `src/lib/tasks/{status,include,defer,create,update,query,summary}.ts`;
`createTask` used by all five creators; `updateTask` shared by PATCH and
field-issue resolve (and completing a task now resolves its field issue,
guarded); `GET /api/tasks/summary`; `GET /api/users/assignable`;
`/api/prospects?withTaskCounts`; `/api/field/today` per-job counts ANDed
with the viewer's scope; count sites on `OPEN_TASK_STATUSES`. Schema:
`Task.estimateId/invoiceId/prospectId/dailyLogId` + indexes on lead/job,
migration `20260924120000_task_entity_links` with a `daily_log_id` backfill
from field issues.

Client: `src/components/tasks/*` (hooks, colours, AddTaskDialog,
EntityTaskPanel, TaskCard, chips, badge, MyTasksWidget),
`shared/user-avatar.tsx`. Integrated into lead detail, job detail, invoice
rows, estimate rows, office daily-log page, prospect cards, dashboard
(widget + clickable Overdue KPI), sidebar badge, field mode (`/field/tasks`
index, bottom nav, job-card chips). `tasks/page.tsx` refactored onto the
shared pieces; the 5-columns-in-a-4-col-grid board bug fixed; `?overdue=1`
and `?assignedUserId=me` seed its filters.

### Verification

427/427 vitest (44 new across create/update/summary/query/dates), typecheck
clean, lint 6 errors / 28 warnings (baseline 6/29), production build clean.
Migration applied to dev via migrate diff → db execute → empty diff → resolve.

Browser QA on dev as ADMIN (SSO bypass + dummy cookie; recipe in memory):
New Task dialog end-to-end with ⌘↵ and the "John notified" toast; the
detail sheet's timeline (created / assigned / emailed); the job Tasks tab
with the context chip and live tab count; the lead Tasks tab showing the
job task through its derived lead; dashboard widget + clickable Overdue
tile; `/field/tasks` + bottom nav badge. Via API: field issue → task with
CREATED/ASSIGNED/EMAIL_SENT, resolve → COMPLETED + STATUS_CHANGED +
completion mail, and the task's `fieldIssue` reads COMPLETED; SALES_REP
sees no tasks on a job that has none of theirs and only their own overall.
One defect found: a date-only due date parsed to UTC midnight, so "due
tomorrow" bucketed under Today in Eastern time — `parseDueAt` pins it to
noon UTC (`ebf1988`).

**Deployed** `ebf1988` at 12:45 ET: migration applied, BUILD_ID
`QpoQxED_Z-y_MMsOudQsc` → `TIVSTNlHVR4hHEDg5rmdU`, smoke 307/307, clean
journal. Backups `pre-deploy-20260924-124523.tar.gz` /
`postgres-2026-09-24-164531.dump`.

---

## 2026-08-03 (later still, 2) — Pending state: unreviewed charges move no money

The structural half of the job-costing control. `ExpenseStatus`
(PENDING/APPROVED/REJECTED) on `JobExpense`, plus `approvedBy`/`approvedAt`/
`reviewNote`.

**The single invariant: only APPROVED contributes.** Enforced at every
derived-financial surface, each of which was checked individually:

| Surface | Change |
|---|---|
| `job-pricing.ts` cost-plus rollup | `status: "APPROVED"` in the expense sum |
| `financials.ts` cost/profit | `where: { status: "APPROVED" }` |
| create → `contractAmount` | increments only when approved on entry |
| PATCH delta | contributes 0 on both sides while unapproved |
| DELETE reversal | reverses only what was actually applied |
| QBO export | approved only |
| budget allocations | refuses an unapproved charge |
| panel totals | pending tracked separately, never folded in |

**`DEFAULT 'APPROVED'`** so the migration is financially inert: all 318
existing rows, cc-allocator postings (already reviewed upstream) and
payroll-generated expenses keep exactly their current behaviour. Only the
CRM's manual-entry path decides otherwise.

**Auto-approve for approvers** (user's call). A charge entered by
ADMIN/MANAGER/OFFICE_STAFF is APPROVED on entry — asking a bookkeeper to
approve their own keystroke is theatre, and they could approve it a second
later anyway. Everyone else's lands PENDING. So today's 6 admins see no
change; the queue exists for the grant-holders the gate was built for.

**Approval is role-only and NOT conferred by `canEnterJobCosts`** — otherwise
a grant-holder files and clears their own charge and the queue is decorative.

The PATCH delta generalisation is the neat part: because an unapproved row
contributes zero on *both* sides, editing a pending charge is automatically
ledger-free with no special case, and approval is just the 0→amount
transition. `POST /api/expenses/[id]/review` is deliberately one-way — no
un-approve, since reversing an increment invoices may already reflect is
worse than deleting (which reverses cleanly).

Rejected rows are kept, not deleted: a charge filed against the wrong job is
still a real cost someone has to re-file.

361/361 tests (15 new), typecheck and build clean, lint unchanged at 6/28.
Migration `20260803170000_expense_review_state`.

---

## 2026-08-03 (later still) — Gate on who may put money on a job

First step of the job-costing check-and-balance work. Analysis found the
premise already true and ungoverned: **`POST /api/jobs/[id]/expenses` and
`PATCH`/`DELETE /api/expenses/[id]` had no role check at all** — any
authenticated user, including READ_ONLY and MARKETING, could create, amend or
delete a job charge. Not cosmetic: a `billable` expense increments
`job.contractAmount` and recomputes `balanceDue`, so anyone with a login
could change what a customer owes.

**A per-user grant, not a new role.** `User.canEnterJobCosts`, following the
existing `canEditPayRates` pattern, because adding a role means editing the
CareyOS portal's `appRoles` — exactly what orphaned Frank's grant during the
cutover. Office roles (ADMIN/MANAGER/OFFICE_STAFF) have it implicitly; the
grant is the escape hatch for a PM or crew lead who genuinely buys materials,
so nobody gets promoted to MANAGER just to file a receipt.

**Explicit role list, never `hasMinRole`** — `ROLE_HIERARCHY` ranks SALES_REP
(60) above OFFICE_STAFF (50), and OFFICE_STAFF is Accounting, so a
minimum-role check would hand sales more financial authority than the
bookkeepers. Pinned by a test. `lib/labor/permissions.ts` carries the same
warning for the same reason.

**Allocator-sourced rows are ADMIN-only to delete.** `externalId` is
cc-allocator's Transaction id and the CRM's idempotency key; deleting the row
undoes nothing upstream, just desyncs the two systems, and a later retry
re-creates it. The refusal message steers people to fix it in cc-allocator.

Checked before shipping: all 82 manual expenses to date were entered by
ADMINs, so this takes access away from nobody.

Migration `20260803160000_job_cost_entry_grant`. 346/346 tests (8 new),
typecheck and build clean, lint unchanged at 6/28.

### Still open from the analysis

The gate is only step 1. The structural fix — **a PENDING charge that does
not touch `contractAmount`/`balanceDue` until approved** — and reconciliation
against cc-allocator are not built. Evidence for why they matter:
**12 candidate duplicate pairs, $9,166.20, 7 of them billable**, where a
manual row and an allocator row share job + vendor + amount + date. Manual
expenses carry `external_id = NULL` and nothing compares the two populations.

---

## 2026-08-03 (later) — Email delivery failures are no longer silent

Built after the MailerSend upgrade, because the cap was only half the
problem. The other half: **every scheduled sender caught per-recipient
errors and still returned HTTP 200**, so a job that reached nobody looked
identical to one that reached everybody. `field-log-digest` was the worst —
it did not track failures at all, only `sent`.

`src/lib/email/delivery-report.ts` — `reportDelivery()`, called once per job
run including on success, so "no news" stops being ambiguous. Three channels
chosen because they fail independently:

1. ERROR log carrying the stable marker `EMAIL_DELIVERY_FAILURE`.
2. An `EmailDelivery` AuditEvent row — reuses the existing audit table, so
   **no migration**, and it is the only channel that still works when email
   is the broken thing.
3. A best-effort ops alert email (`OPS_ALERT_EMAIL`, else oldest active
   ADMIN), recursion-guarded so a failing alert cannot alert about itself.

Also catches the **silent-skip** case that had no detection at all: sends
attempted, none succeeded, nothing thrown — meaning the provider is
unconfigured and every message was dropped. Previously indistinguishable
from a clean run.

Wired into `cron.task-reminders`, `cron.field-log-digest`,
`cron.field-log-reminders` and all four task notifications. Cron responses
now report `attempted` alongside `sent` and list failed recipients.

`GET /api/admin/email-health` (MANAGER+) rolls the audit rows up **by
recipient**, since "who is not receiving mail" is the question people
actually arrive with.

338/338 tests (9 new), typecheck and build clean, lint unchanged at 6/28.

---

## 2026-08-03 — Task collaboration: notification email, notes, history

Built out the Task module: branded email on assignment and completion, notes,
a per-task activity trail, watchers, @mentions, a BLOCKED status and a morning
reminder digest. **Deployed as `d12945e`** (BUILD_ID
`bckl0-luXQ4XIe0WqzwFl` → `F5tEnwV3x13sc-0OYUI2a`), migration applied, smoke
tests 307/307, clean journal. Reminder cron installed at `30 11 * * 1-5` then
**commented out the same day** — see the MailerSend finding below. Assignment,
completion and mention mail stayed live.

### 🔴 Found on the first live cron run: MailerSend is a TRIAL account

The first real invocation returned `{"tasks":5,"people":4,"sent":2,
"failures":2}` — MailerSend answered `422 … trial account unique recipients
limit #MS42225` for two people, who therefore got nothing. This is an account
limit, not a defect: the code raised, logged and recorded `EMAIL_FAILED` as
designed. **It caps every outbound email the CRM sends** — estimates, change
orders, payroll, follow-ups — and predates this work; the task module merely
exercised enough distinct recipients to expose it. Fix is commercial.

### Five pre-existing defects found and fixed

The first four surfaced while reading the module; the fifth while writing its
tests. All were live in production.

1. **Unassigning a task was broken.** The board sends `assignedUserId: null`,
   but `updateTaskSchema` used `z.string().optional()`, which rejects null →
   400 → a generic "Update failed" toast.
2. **Clearing a due date was broken**, same cause.
3. **`priority` was silently reset to MEDIUM on every save.** `.partial()` does
   not strip `.default()`, so the create schema's default landed in every PATCH
   and the route spread it into the write. **Ticking an URGENT task complete
   downgraded it to MEDIUM.** The most damaging of the five and the hardest to
   notice — nothing errors, the value just quietly changes.
4. **`completedAt` was never cleared on reopen** (`undefined` means "leave
   alone" in Prisma), so reopened tasks kept a stale completion timestamp.
5. **PATCH had no authorization.** GET scoped a SALES_REP to their own rows;
   PATCH checked only that a session existed, so any authenticated user could
   modify any task by id. Both sides now derive from `lib/tasks/access.ts`.

### Schema

`20260803120000_task_collaboration`, applied to dev via migrate diff + db
execute + resolve (verified with an empty diff before `resolve`).

- `TaskEvent` — one chronological feed carrying BOTH notes and system events.
  Single table so the timeline is one ordered read with no merge step; only
  `NOTE` rows are editable. `EMAIL_SENT` / `EMAIL_FAILED` rows make "was he
  actually told?" answerable in-product.
- `TaskWatcher`, `Task.completedByUserId` / `assignedAt` / `blockedReason`,
  `TaskStatus.BLOCKED`, `User.taskEmailsEnabled`.
- Backfill seeds a `CREATED` event per existing task — otherwise an older task
  opens to an empty timeline, which reads as lost history.

### Email

`lib/tasks/task-email.ts` renders bodies only and delegates the shell to the
existing `renderEmailLayout` + `getEmailBrand`, so task mail matches the
estimates and change orders the same people already receive. Tables and inline
CSS throughout. Assigned / completed / blocked / mention / reminder, each with
a plain-text alternate.

Dispatch is best-effort and runs in `after()` (Next 16, supported on a Node
server): the task write commits first, and a MailerSend outage can never turn
a successful assignment into a 500.

Suppression rules, all tested: muted, inactive, blank address, and "don't mail
someone about their own click". Completion is the deliberate exception — it
goes to assignor and assignee both, as specified. Links route by the
RECIPIENT's role, so crew leads get `/field/tasks/[id]` and office users get
`/tasks?task=[id]`; a new field-mode task page was added for the former.

### Mentions

Longest-match-at-position, not per-user first-match. The first implementation
had a real bug caught by its own test: Frank Ruiz's email local part is
`frank`, so "@Frank Delgado" matched both men. A handle claimed by two people
now resolves to nobody — with two Franks, "@Frank" mails neither, and the
composer's autocomplete is what steers the author to a full name.

### Verification

329/329 vitest (was 328/36 files; 6 new suites, 58 new tests). Typecheck
clean. Production build compiles; `/tasks` and `/field/tasks/[taskId]` are
both dynamic. **Lint 6 errors / 28 warnings — one warning better than the
6/29 baseline** (an unused `format` import went away). No manual QA in a
browser yet.

---

## 2026-08-03 — SSO happy path verified in production

Operator-confirmed. No code changes, no deploy.

- **Frank (CREW_LEAD) signs in and lands on `/field`.** This was the one
  genuinely load-bearing unknown from the cutover — the user with no
  fallback if the grant→role mapping were wrong. It works.
- **Sign-out bounces to the CareyOS portal**, not a dead local `/login`.
- An office-role login (ADMIN/MANAGER/…) was not separately exercised.
  Frank passing exercises the whole chain — cookie exchange, portal call,
  grant→role mapping, CREW_LEAD confinement — so the residual gap is only
  the office shell's own redirect, the better-trodden of the two paths.
- **The rollback window is closed.** `0759ee8` stands. No migrations ever
  ran, so nothing needs unwinding either way.

Decisions taken this session:

- **jgarcia stays ADMIN.** His portal grant (ADMIN) outranks his pre-cutover
  CRM role (MANAGER), so his next login syncs the CRM row up. Confirmed
  intended — a promotion, not an accident. No action needed.
- **The old domain holds at 302.** One verified login is not a week of clean
  traffic, and browsers cache 301s hard. Promote later, deliberately.

---

## 2026-07-23 — Domain cutover to crm.careyos.com + CareyOS SSO (deployed)

Moved the CRM onto the CareyOS fleet: new hostname, portal SSO, local
passwords retired. Seven commits, `69a5c3c..0759ee8`, 43 files,
+1592/−674. Two production deploys of this app plus one of the portal.

### Infrastructure discovery (corrected a wrong assumption)

Both domains were already on **the same droplet** — knuco-droplet
161.35.0.183. An earlier reading placed CareyOS on everglade-droplet; that
was wrong. Everglade's catch-all vhost answers any `Host` header, so a
`--resolve` probe returned 200 and looked like proof. Byte-identical
response bodies settled it: knuco is the CareyOS origin (74642B,
`<title>CareyOS — Internal Operating System</title>`), everglade serves
zylow (1691B). **Consequence: the planned host move — containerise,
Postgres dump/restore, uploads transfer, replace deploy.sh, downtime
window — was cancelled entirely.**

`crm.careyos.com` was already a Cloudflare record pointing at everglade,
returning 526 (everglade presents a `closers.zylow.net` cert).

⚠️ SSH to **everglade-droplet runs a deploy script on login** (ForceCommand
or equivalent). An intended read-only inspection instead fetched main and
rebuilt `buyback_app`. All layers were CACHED so nothing shipped, but do
not SSH there casually. knuco-droplet has a normal shell.

### Phase 1 — domain portability (b86fbbb)

`NEXTAUTH_URL` was doing two jobs: NextAuth's callback origin, and the
public host stamped into every outbound link. Split the second into
`APP_BASE_URL` (optional, falls back to `NEXTAUTH_URL`, trailing slash
stripped centrally). Eight call sites repointed: tracked links, unsubscribe,
`/co` portal, password reset, both field-log crons, Zapier roofr callback.
`deploy.sh` `PUBLIC_URL` → `${KNUCO_PUBLIC_URL:-…}`.

That last bit mattered immediately: deploy.sh's laptop smoke test accepts
only 200/307, and the old domain now 302s — an unmodified script would have
failed *after* shipping. Every deploy since runs
`KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh`.

### Phase 3 — the cutover itself

Executed old-domain-first so nothing broke mid-flight:

1. **nginx vhost** `crm.careyos.com` → `127.0.0.1:4000`, reusing the
   existing `/etc/ssl/cloudflare/careyos-origin.{pem,key}` (already covers
   `*.careyos.com`). Modeled on the `fuel.careyos.com` vhost.
2. **`/etc/nginx/snippets/cloudflare-real-ip.conf`** — CF v4/v6 ranges +
   `real_ip_header CF-Connecting-IP`. The old host was a direct A record;
   the new one is proxied, so without this every request arrives as a
   Cloudflare edge IP, poisoning `resolveTrackedLink`'s `ipAddress` and
   collapsing IP-keyed rate limiting into shared buckets. Verified working
   (real IPv6 in the access log). **The box had no CF real-IP config at
   all — the other proxied apps still log edge IPs.**
3. **Cloudflare DNS** repointed to 161.35.0.183 (Richard, dashboard — no
   API credentials exist on the droplet).
4. **`/etc/knuco/env`**: `NEXTAUTH_URL` + `APP_BASE_URL` →
   `https://crm.careyos.com`. Backup `env.bak-20260723-precutover`.
5. **Old domain → 302** preserving path and query, ACME path exempt so the
   LE cert keeps renewing. Backup `knuco.bak-20260723-precutover`.

**`/api/integrations/` on the old domain is proxied, not redirected.**
Machine callers POST there and Node's fetch downgrades POST→GET when
following a 302, silently dropping the body. This had already broken
cc-allocator's expense postings between the redirect going in and being
noticed. Zapier's Roofr callback bakes its URL in per order and 3 orders
sat in `REQUESTED`, so the exemption protects them too.

External callers swept: **cc-allocator** `CRM_BASE_URL` repointed +
restarted (verified 200 with real job data); **knu-phone-routing** has no
CRM references yet; **cron** — all four `/home/knuco/crm-cron/*.sh` hit
`127.0.0.1:4000` directly, unaffected; **Twilio** is outbound-only.

### Phase 2 — CareyOS SSO (0759ee8)

CareyOS (`app.careyos.com`, port 3000, `/var/www/careyos`) is its own IdP —
no third party. Two integration modes exist; being on `.careyos.com` put
the CRM in the simple one: forward the `careyos_session` cookie (scoped
`.careyos.com`) to `/api/sso/authorize`. **The redirect-handoff flow in the
portal's `docs/sso-external-domain.md` was written for the CRM and is now
unnecessary — doing the domain first avoided building and discarding it.**

- **`src/lib/sso.ts`** — introspection, `loginUrl()`, `logoutUrl()`. Fails
  closed on every path. We never hold `CAREYOS_SSO_SECRET`.
- **`src/lib/auth/helpers.ts` is the seam.** `getSession`/`requireSession`/
  `requireRole` kept signatures and shape, so **~140 route handlers and
  pages needed no edits**. Wrapped in `React.cache` — one introspection per
  request, not N. Find-or-creates the CRM `User` by email (anchor for FKs)
  and mirrors `appRole` onto `role_id`.
- **Middleware** dropped to a cookie-presence check (edge has no DB, no
  role). Role enforcement moved to the `(dashboard)`, `(dashboard)/admin`
  (new) and `(field)` layouts, resolved live — stronger than reading a role
  off a JWT valid until expiry.
- **Client**: `next-auth/react` → `src/lib/auth/session-client.tsx`,
  API-compatible so six consumers changed only an import. Backed by new
  `/api/me`. `signOut()` → `/api/auth/sign-out` → portal logout.
- **Removed**: `[...nextauth]` route, `auth/options.ts`, forgot/reset
  password pages and routes. `/login` is now a portal bounce that honours
  only relative `callbackUrl` (no open redirect).

### Portal-side changes (careyos repo, `archieves305/careyos`)

Deployed via `scripts/deploy-careyos.sh` (pull → npm ci → build → pm2
restart → health check). Healthy, HTTP 200, fleet unaffected.

- `6021c30` — `construction-crm` appRoles replaced: the placeholder four
  (ADMIN/MANAGER/**FIELD**/VIEWER) had no equivalent for SALES_REP,
  OFFICE_STAFF or MARKETING and would have flattened them. Now verbatim
  the CRM's seven `RoleName` values, `defaultAppRole: READ_ONLY`.
- `c79862b` — registry entry described an app that did not exist:
  `serverPath /var/www/construction-crm` (real `/opt/knuco`), `port 3116`
  (real 4000), pm2 (real: systemd `knuco`). Corrected; `url`/`subdomain` →
  `crm.careyos.com`. `status` left `"development"` — the app is in daily
  production use but its SSO integration was not yet proven.

### Data changes (no schema migrations)

- **careyos `AppAccess`**: Frank's grant `FIELD` → `CREW_LEAD` (scoped to
  the row PK). `FIELD` no longer exists in the deployed list;
  `decideAppAccess` would have degraded him to `READ_ONLY`.
- **CRM `users`**: `jgarcia@knuconstruction.com` →
  `jgarcia@calibertrust.com`, in place, preserving
  `id=cmovhcyfu000jkrbtdg9bf0rm`. SSO matches on email, so a mismatch would
  have minted a second user and orphaned **23 rows across 9 tables**
  (leads, stage history, assignments, activity, files, jobs). Verified all
  23 still resolve. A prior scan confirmed `users.email` was the only place
  that address was stored.
- Grants for erica / lvalladares already existed by the time they were
  applied (`INSERT 0 0`, `ON CONFLICT DO NOTHING`) — Richard added them.

### Bugs fixed

- **Unsubscribe links never worked** (pre-existing, silent).
  `/api/email/unsubscribe` was missing from the middleware allowlist, so
  every recipient — and Gmail's `List-Unsubscribe-Post` POST — was 307'd to
  `/login` before the route ran. The route verifies its own HMAC token,
  rate-limits itself and renders standalone HTML; it was always meant to be
  public. Fixed narrowly (`/api/email/unsubscribe`, not `/api/email`) and
  covered by `src/middleware.test.ts`, verified to fail without the fix.
- **cc-allocator expense postings** silently failing via POST-through-302
  (above).
- **Portal registry** pointing at a non-existent path/port/process manager.

### Verification

- 257/257 vitest across 29 files (was 233/27). Typecheck clean. Production
  build compiles. Lint 6 errors / 29 warnings — **unchanged baseline**, all
  in files not touched this session.
- Deploy 1 `fde7bb2` (140s) — unsubscribe fix live, `APP_BASE_URL` active,
  phone-routing route present.
- Deploy 2 `0759ee8` (154s) — SSO. Clean journal, 26/26 pm2 online.
- Production probes: anonymous → portal login with return path preserved;
  `/api/me` no cookie → denied; **forged cookie → 401 on `/api/me` and 307
  on `/jobs`** (proves the portal call happens and fails closed); removed
  credential routes 404.

⚠️ **The authenticated happy path was not verified at deploy time** —
obtaining a real `careyos_session` requires a CareyOS password, so a human
had to confirm it. **Since closed: verified 2026-08-03** (Frank/CREW_LEAD →
`/field`, sign-out → portal). The rollback path below is retained for the
record only; it is no longer the standing recommendation.

Rollback (historical): `git revert 0759ee8 && git push`, redeploy; or the
tarball `/var/backups/knuco/pre-deploy-20260723-094258.tar.gz`. No
migrations ran, so the DB was unaffected either way.
