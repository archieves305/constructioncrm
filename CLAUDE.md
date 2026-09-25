@AGENTS.md

# Claude Project Memory — KNU Construction CRM

_Concise by design. Full detail lives in [docs/project-memory/](docs/project-memory/)._

## 1. Project Purpose

CRM for KNU Construction: leads → estimates → jobs → invoicing in one
pipeline, plus a field-labour module (daily logs, crew hours, payroll) and
canvassing. Receives expense postings from cc-allocator. Part of the CareyOS
app fleet.

## 2. Current System Architecture

Next.js **16.2.3** (App Router) + Prisma/PostgreSQL, on knuco-droplet
(161.35.0.183) at `/opt/knuco`, port 4000, under the **systemd unit
`knuco`** — the only fleet app not on pm2. Public host
**`https://crm.careyos.com`** (Cloudflare-proxied). Env at `/etc/knuco/env`.

The same droplet runs CareyOS (`/var/www/careyos`, pm2, port 3000) and ~14
sibling `*.careyos.com` apps.

Auth is **CareyOS SSO** — see §9 and
[features/careyos-sso.md](docs/project-memory/features/careyos-sso.md).
Details: [architecture.md](docs/project-memory/architecture.md).

## 3. Active Workstreams

0. 🔴 **Tasks as the spine of the CRM** — three stages, each deployed and
   QA'd before the next. **Stage 1 (tasks everywhere) deployed 2026-09-24**
   (`ebf1988`, BUILD_ID `TIVSTNlHVR4hHEDg5rmdU`, migration
   `20260924120000_task_entity_links` applied). **Stage 2 (email
   follow-up) deployed 2026-09-24** (`4b6021d`, BUILD_ID
   `YehfWHd9zfW9-YxNcwwzN`; escalations stay off until SPF exists).
   **Stage 3 (visual redesign) deployed 2026-09-24** (`e867c5e`, BUILD_ID
   `JAfdl5DEJdIShaUiCFbG2`) —
   [features/design-system.md](docs/project-memory/features/design-system.md).
   All three stages are live; what remains is operator config (SPF →
   `TASK_ESCALATIONS_ENABLED=1`, then `TASK_AUTO_RULES_DISABLED=`) and
   Richard's own click-through. Notes:
   [features/tasks.md](docs/project-memory/features/tasks.md).
1. ✅ **Progress billing — complete.** Stage 1 deployed + JOB-00009
   backfilled 2026-08-27; Stage 2 (change orders → SOV line) `6b3868b` and
   Stage 3 (retainage release + Collections split) `4833ea3`, both
   2026-09-24. Apps 13–14 on JOB-00009 still to be entered in the UI by
   Richard; retainage release is a normal application at a lower rate.
2. ✅ **Job-costing check-and-balance — complete.** Write gate, pending
   state, and (2026-09-24, `3e8b211`) the cc-allocator reconciliation:
   intake guard holds a posting that twins a manual charge as PENDING,
   credits are accepted, expense deletes are audited, and the **Cost
   Reconciliation** admin page rules on pairs. Books cleaned the same day:
   19 duplicates removed ($16,070.96), 23 credits posted (−$7,580), BNW
   $11,694.15 job-costed. Findings + outcome:
   [job-cost-reconciliation-2026-09-24.md](docs/project-memory/job-cost-reconciliation-2026-09-24.md).
   **Phase 2 deployed 2026-09-25 (`972affe` + cc-allocator PR #32)**: the
   page reads cc-allocator's postings export and shows "posted but missing
   here", "linked, never posted" (with the reason) and "held for review".
   **Connected 2026-09-25** (key placed at Richard's request, both apps
   restarted): the card shows the 3 intentionally deleted postings as
   "missing here" (they will keep showing — an acknowledge action is a
   possible follow-up), 6 never-posted rows in cc-allocator's queue
   ($5,125.27), 0 held.
3. ✅ `field-log-digest` self-healed — prod journal shows every weekday run
   since the MailerSend upgrade at `attempted 6, sent 6, failures 0`
   (checked 2026-09-24 across Sep 17–24).
3. Add the SPF record for `knuconstruction.com` (see §5).
3. Set `PHONE_ROUTING_API_KEY` to activate the phone-routing integration.
4. ✅ Dead-code cleanup from the auth swap — done 2026-09-24 (`cf746a2`).
5. Promote the old domain's 302 → 301 — **deliberately parked**, not
   blocked (see §5).

The SSO cutover is **done and verified**; jgarcia's role is **decided**.

## 4. Session Log (latest — full history in [session-history.md](docs/project-memory/session-history.md))

### 2026-09-25 — Job-cost reconciliation, Phase 2 (deployed; keys pending)

cc-allocator PR #32 (`75078d4`, deployed with
`/var/www/careyos/scripts/deploy-ccallocator.sh` **run as `knuco`** — root
has no GitHub key, and a stashed local `package-lock.json` drift had been
blocking `git pull`): `GET /api/internal/crm-postings`, bearer
`CRM_RECON_API_KEY`, every card/bank row with a CRM job or expense id in
one flat shape. CRM: `lib/integrations/cc-allocator/postings.ts` (fetch +
zod, 10s timeout, never throws), pure `lib/expenses/reconcile-allocator.ts`
(`missingInCrm` / `neverPosted` with reason / `heldPending`), `allocator`
block on `GET /api/admin/job-cost-reconciliation`, "From cc-allocator's
side" card. The env-file writes were refused by the auto-mode classifier,
so Richard asked for it explicitly and the same command then went
through: key placed, both apps restarted, the CRM's own
`fetchAllocatorPostings` + classifier run on prod → counts 279/102/374,
missing 3 ($25,584.10, the intentional deletions), never posted 6
($5,125.27: four bank rows queued/awaiting, two card rows in flight),
held 0. Also fixed: archived `scripts/cc-allocator/*` had broken
typecheck on `main` since `107f43c` — excluded in tsconfig. 615 tests,
lint 6/28. **Deployed `972affe`** (build `-1tKwAW5IigEUf_Jhe-Sm`).

### 2026-09-24 — Job-cost reconciliation, Phase 1 (deployed + applied)

Richard ruled on the findings the same evening. Built: pure
`lib/expenses/reconcile.ts` (twin = manual APPROVED non-payroll row, same
job + amount, ±3 days; `findManualTwin`, `pairCandidates`); intake creates a
twinned posting **PENDING** with a review note and accepts **negative
amounts** (credits) from that route only; `lib/expenses/delete.ts` is the
one audited delete path (`expense_delete`); `ExpenseReconciliation`
(migration `20260926120000`) + `GET/POST /api/admin/job-cost-reconciliation[/resolve]`
(`canApproveJobCosts` list) + `/admin/job-cost-reconciliation` page.
Applied on prod through `resolvePair`: **19 duplicates removed
($16,070.96; the doc had said 18 — 10+4+3+2 is 19, dollars were right), 2
KEEPs**; 19 audit events. cc-allocator side via two scripts kept in
`scripts/cc-allocator/`: BNW $11,694.15 → JOB-00010, 23 credits → −$7,580
(BullMQ job-id dedupe needed the stale jobs removed first). Prod: 453
expenses, 0 pending, 0 CRM errors in cc-allocator. 612 tests, lint 6/28.
**Deployed `3e8b211`** (build `P9PjvUEYphWrWc-OX3EMp`).

### 2026-09-24 — Job-cost reconciliation pressure test (no code)

Read-only diff of cc-allocator (`Transaction` 279 CRM-linked / 253 posted,
`BankTxn` 102 / 97) against CRM `job_expenses` (448, all APPROVED; 348
external, 99 manual). Agrees: 347 rows exact on amount/job/type/date
(billable flag drifts on 101 rows, cosmetic). Missing in CRM though
cc-allocator holds a `crmExpenseId`: 3 bank postings $25,584.10 (deleted;
expense deletes are unaudited). Never posted: 23 card credits −$7,580
(intake refuses negatives → refunds never reach costing), 5 bank rows
$16,443.75 (one `postCrm` off, three queued, one unassigned). Manual↔
allocator twins: **20 pairs $16,502.96** (was 12 / $9,166.20 in August;
manual first in 19/20; JOB-00006 $432 and a ±3-day $800 look genuine).
Correction: none inflate a customer bill — the "billable" ones are on the
owned rehab. Proposal: Phase 1 CRM-only (intake guard creating PENDING on
a ±3-day manual twin, accept negative postings, reconciliation page with
audited "confirm duplicate → delete manual row"), Phase 2 a postings
export from cc-allocator. Findings in
`docs/project-memory/job-cost-reconciliation-2026-09-24.md` and at
https://claude.ai/artifact/Afy7pAJjbqSdvKRo7GFnxG. Nothing deployed.

### 2026-09-24 — SSO dead-code cleanup + pickers (deployed)

Removed `lib/auth/lockout*`, `password-policy` (+ tests) and
`scripts/create-admin.ts`; `/api/admin/users` is GET-only and PATCH no
longer takes `password` (admin page loses Add User / Password and says
users come from CareyOS); `next-auth`, `bcryptjs`, `@types/bcryptjs`
uninstalled; seed writes the `"sso:careyos"` sentinel. Seven assignee
pickers (jobs list, job permit form, leads list, lead detail, new/edit
lead, permits) moved from `/api/admin/users` to `/api/users/assignable`
under the `assignable-users` key — ADMIN/MANAGER-only surfaces stay.
Digest check closed from the prod journal. Verified as SALES_REP on dev
(assignable 200, admin 403, create 405). 605/605 tests, **lint 6/28**,
build clean. **Deployed `cf746a2`** (no migration; build
`3FNcA-gRq83Kv0jIR_b9V`).

### 2026-09-24 — Progress billing, Stage 3 (deployed)

Retainage release = an application at a lower rate, no schema change:
`computeApplication` gains `previousRetainagePercent` → `previousRetainage`,
`retainageReleased`; JOB-00009 full release after app 12 is exactly
$60,742.90. `getBillingSummary` adds `effectiveRetainagePercent` (latest
issued app's rate; drafts/VOIDs never move it), `retainageReleasedOn`,
`totals.retainageReleased`; `Job.retainagePercent` stays nominal. Inputs
accept `retainagePercent` + empty lines; guards ordered over-scheduled →
negative due → nothing billed/released; `bad_retainage`. G702 PDF prints
the release line. Collections: `getProgressPositions` splits `balanceDue`
into open A/R + retainage held + balance to finish (sums exactly; read
model only) → "Progress-billed jobs" card + Outstanding KPI sub-line.
Dialog: rate field with Release half / all / Keep, live release row,
"Create release draft". Dev QA: 9,000 → 500 → (draft 1,000 → 500) →
4,750 → 750 all reconcile; QA rows purged from dev. 618/618 tests, lint
6/29. **Deployed `4833ea3`** (no migration; build `5-_3pStOG66-kWTGKKfmr`).
Details: [features/progress-billing.md](docs/project-memory/features/progress-billing.md).

### 2026-09-24 — Progress billing, Stage 2 (deployed)

Change orders on PROGRESS jobs: approval adds a `SovLine` linked by
`changeOrderId` (migration `20260925120000_change_order_sov_lines`) via the
pure `changeOrderSovLine` (`lib/billing/sov.ts`) instead of issuing an
invoice; billed through the next applications. Fixed-price contract still
increments so Σ SOV = contract. Linked line: value read-only (400),
undeletable via `/api/sov` (409); deleting the CO removes the line, refuses
`has_billing` once a live application billed on it, and drops VOID
applications' line rows first (dev QA caught the FK 500). No
`invoice.sent` task for SOV approvals. UI: "SOV item #n" in the CO panel,
"Approve & add to SOV", `CO-n` badge on the Invoices tab. Prod had no COs
on its one PROGRESS job → no backfill. 613/613 tests, lint 6/29.
**Deployed `6b3868b`** (migration applied; build `ZL4mI9LnfV2k2DeUusDC4`).
Details: [features/progress-billing.md](docs/project-memory/features/progress-billing.md).

### 2026-09-24 — Trade Workflow Templates, Stage 3 (deployed)

Jobs API filters through a pure `buildJobListWhere` (`lib/jobs/query.ts`:
`workflowTrade`, `permitStatus` incl. `NONE`, `phaseKey`,
`workflowBlocked/Overdue/Unassigned`) and `withWorkflow=true` per-job
summaries (`lib/workflows/summary.ts`, three queries a page). Jobs list:
Workflow filter row (URL-seeded), Phase column, permit pill, 7 CSV
columns; board card: phase + chips; dashboard `WorkflowHealthWidget`
(`?type=workflow-health`, own-jobs scope for non-office roles). Reporting:
`?type=workflow` → `lib/workflows/reports.ts` (durations by trade/phase +
phase cycle time, overdue by role, stalled steps via `classifyDelayCause`,
lead times, most-skipped people-vs-engine); Workflow section on /reports
with CSV. Explicit role list `canViewWorkflowReports` (ADMIN, MANAGER,
OFFICE_STAFF, READ_ONLY). Headless-Chromium QA on dev (Chrome tool refuses
to set the dev cookie). 604/604 tests, lint 6/29. **Deployed `f332e26`**
(no migration; build `W3SSiv0mXjZ3bx9g0kTOU`). Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-24 — Trade Workflow Templates, Stage 2 (deployed)

One reconcile engine for every re-plan (`ReconcileChange`: permit decide
or reverse with a required reason when dropping it, add/remove trade with
per-task retain, scope, version upgrade with drift report): build the plan
→ diff (`toCreate / toReinstate / toSkip / preserved`) → apply by adding,
reinstating engine skips and skipping through `updateTask`. Never deletes;
completed, manual, correction and user-skipped tasks are untouched.
`previewReconcile` powers the two-step dialogs. Inspections: PASS /
CONDITIONAL / FAIL with correction tasks; a failed step reopens as Ready
when its corrections close. Versioning: drafts, collected validation with
"Go to step", publish supersedes, jobs pin and the tab offers upgrades.
Template Library editor (`/admin/workflow-templates/[id]`) with sortable
phases and steps, a full step sheet and a client-side cycle check — no
raw JSON. Manual dependencies route. QA found one defect (reopen waited on
ordinary predecessors) — fixed. 579/579 tests, lint 6/29. **Deployed
`5528cba`** (no migration; build `0SgZtTjvxkoK30iIR74tF`).

### 2026-09-24 — Trade Workflow Templates, Stage 1 (deployed)

Reusable, versioned phase-and-step templates that generate **ordinary
tasks**. Core Construction + Roofing / Interior Renovation / Doors &
Windows, composed per job with a Permit / No-Permit branch (exact legal
warning), scope toggles, role-based assignment (team slots → job PM/sales
→ admin defaults), business-day due dates from predecessors, blocking
gates, checklists and required evidence. Migration
`20261001120000_workflow_templates` (+ `activated_at` backfill so no count
moved). Pure `compose()`; `apply` is idempotent (second apply creates 0,
unique index as backstop); activation runs inline from `updateTask`.
Workflow tab first on the job, Apply dialog with preview, task-sheet block,
`/tasks` filters, admin Workflow Templates (read-only) + Workflow Roles.
563/563 tests, lint at baseline. **Deployed `2790b88`** (migration applied,
build `uvoRaHDsO4HPJEnijWxig`); prod seeded with the four v1 templates
(second run: unchanged). Details:
[features/workflows.md](docs/project-memory/features/workflows.md).

### 2026-09-24 — Task edit + delete (follow-up)

Richard: "I should be able to edit and delete tasks as well." Inline
title/description editing in the sheet, and a delete with confirmation
behind `DELETE /api/tasks/[id]` + `canDeleteTask` (office roles or the
raiser), audited. Browser-QA'd on dev; 482/482 tests.

### 2026-09-24 — Visual redesign (Stage 3 of 3; deployed `e867c5e`)

Steel-blue brand + tone + five-phase stage tokens in `globals.css`;
`lib/ui/stage-colors.ts` derives a stage's colour from its order (tested);
`components/kanban/*` replaces the three hand-rolled boards (`/production`
now shows every DB stage, `/pipeline`, the tasks board) with mouse, touch
and keyboard drag and per-board collapsed columns; `EntityHeader` +
`StageStepper` (confirm dialog) on job and lead detail; job tabs grouped
into Money · Field · Permits · Tasks · Files · History with `?tab&sub` in
the URL; jobs and leads lists on `StagePillSelect`, `Progress`,
`PermitBadge`, avatars, sticky headers, skeleton and empty states; tasks
page header with summary pills, segmented view toggle, filter drawer, brand
"New task" with an `n` shortcut. New primitives: progress, skeleton,
segmented-control, dropdown-menu (shadcn), empty-state. Details:
[features/design-system.md](docs/project-memory/features/design-system.md).

### 2026-09-24 — Task email follow-up (Stage 2 of 3; deployed `4b6021d`)

Nudge (`POST /api/tasks/[id]/nudge`, 24h cooldown, sheet button), per-task
"remind me on" delivered by the morning digest, overdue escalation to the
raiser then managers (`lib/tasks/escalations.ts`, **off until
`TASK_ESCALATIONS_ENABLED=1`**), and auto follow-up tasks on estimate sent /
invoice sent / daily log returned / change order sent, auto-closed when the
event resolves (`lib/tasks/auto-tasks.ts`, `invoice.sent` disabled by
default). Per-user channel toggles at `/settings/notifications`.
`requireCronSecret()` now gates all eight cron routes. Migration
`20260924130000_task_followups`. Details:
[features/tasks.md](docs/project-memory/features/tasks.md).

### 2026-09-24 — Tasks everywhere (Stage 1 of 3; deployed `d7262d0`/`ebf1988`)

One creation path (`lib/tasks/create.ts`) and one update path
(`lib/tasks/update.ts`) — the deposit task, stage templates, follow-up rules
and field issues had all been creating tasks silently, and field-issue
resolve skipped the completion mail. New `Task` links to estimate, invoice,
prospect and daily log (migration `20260924120000_task_entity_links`).
Shared `AddTaskDialog` / `EntityTaskPanel` / hooks in `components/tasks/*`,
integrated into lead + job detail, invoice and estimate rows, the office
daily-log page, prospects, dashboard widget, sidebar badge, and field mode
(`/field/tasks` + bottom nav). Fixed BLOCKED being dropped from three
"open" counts and assignee pickers 403ing for non-admins (`/api/users/assignable`).
Browser-QA'd on dev (create from /tasks, job tab, lead tab; sheet timeline;
dashboard widget; field index + bottom nav; field-issue round trip via API;
SALES_REP scoping via API) — one fix out of it: date-only due dates are now
pinned to noon UTC so "due tomorrow" stops bucketing under Today. 427/427
tests, typecheck/build clean, lint 6/28. Deployed 12:45 ET, smoke clean.
Details: [features/tasks.md](docs/project-memory/features/tasks.md).

### 2026-08-27 — Progress billing / payment applications (deployed + backfilled)

Bill work completed in a period instead of the whole balance — AIA
G702/G703 style, driven by JOB-00009. `Job.billingMethod` + retainage,
`SovLine`, applications as `Invoice` + `InvoiceLine`, G702 PDF, Invoices-tab
UI, migration `20260827120000_progress_billing`. Retainage defaults 10%
commercial / 0% residential; one SOV line per contract. 387/387 tests, build
clean. Deployed `891b891`/`78e3d6c`; backfill ran on prod, all 12 amounts
reproduced. Apps 13–14 go in through the UI. Details:
[features/progress-billing.md](docs/project-memory/features/progress-billing.md).

### 2026-08-03 — Task collaboration (deployed as `d12945e`)

Assignment/completion email on the existing branded shell, notes, a per-task
activity trail, watchers, @mentions, BLOCKED status, morning reminder digest.
New: `src/lib/tasks/*`, `src/components/tasks/*`, notes/watchers routes,
`/api/cron/task-reminders`, `/field/tasks/[taskId]`, migration
`20260803120000_task_collaboration`.

**Five pre-existing defects fixed.** Unassign and clear-due-date both 400'd;
`completedAt` survived a reopen; PATCH had no role check; and — worst —
`.partial()` does not strip `.default()`, so **every save silently reset
priority to MEDIUM**, downgrading URGENT tasks on completion. Details in
[known-issues.md](docs/project-memory/known-issues.md).

329/329 tests, typecheck and build clean, lint one warning better than
baseline.

### 2026-08-03 — SSO verified; two decisions closed

No code changes. Frank (CREW_LEAD) signs in and lands on `/field` — the one
load-bearing unknown from the cutover — and sign-out bounces to the portal.
The rollback window is closed; `0759ee8` stands. jgarcia **stays ADMIN**
(confirmed intended, not drift). The old domain **holds at 302** — one
verified login is not a week of clean traffic.

### 2026-07-23 — Domain cutover + CareyOS SSO (deployed)

`69a5c3c..0759ee8`, 7 commits, 43 files, +1592/−674. Two app deploys plus a
portal deploy.

- Moved `crm.knuconstruction.com` → **`crm.careyos.com`**. Old host 302s,
  preserving path + query so emailed `/co` and `/action` links survive;
  `/api/integrations/` is **proxied not redirected** (POST→GET through a 302
  loses the body — this silently broke cc-allocator mid-cutover).
- Discovered both domains were **already on the same droplet**, cancelling
  the planned host move (containerise, DB restore, downtime window).
- Split `APP_BASE_URL` out of `NEXTAUTH_URL` so the public host is one env
  var, decoupled from auth.
- Added the Cloudflare **real-IP** snippet — the host is now proxied, so
  without it every client looks like an edge IP.
- Replaced NextAuth credentials with **CareyOS SSO**. `helpers.ts` was the
  seam, so ~140 route handlers needed no edits.
- Portal repo: `construction-crm` appRoles → the CRM's real seven; registry
  entry corrected (it described a non-existent app).
- **Fixed: unsubscribe links never worked** — `/api/email/unsubscribe` was
  missing from the middleware allowlist, so recipients were 307'd to
  `/login`. Pre-existing and silent.
- Data: Frank's grant `FIELD`→`CREW_LEAD`; jgarcia's CRM email renamed in
  place, preserving 23 referencing rows.

## 5. Known Issues / Technical Debt

Full list: [known-issues.md](docs/project-memory/known-issues.md).

- **SPF is unset on `knuconstruction.com` in MailerSend** (`dkim: true`,
  `spf: false`). Delivering fine today, but strict receivers may spam-folder
  it. Next most likely cause of "never arrived" reports now that the
  recipient cap is resolved.
- Delivery failures now escalate through `lib/email/delivery-report.ts`
  (ERROR log with marker `EMAIL_DELIVERY_FAILURE`, an `EmailDelivery` audit
  row, and a best-effort ops email). Read history at
  `GET /api/admin/email-health` — the channel that still answers when email
  itself is what is broken. Optional `OPS_ALERT_EMAIL`, else oldest active
  ADMIN.
- `PHONE_ROUTING_API_KEY` unset → that endpoint 503s.
- Old domain still 302, not 301 — deliberate, and **still deliberate after
  SSO was proven**. Promote when the old host goes quiet. It is an nginx
  vhost edit on the droplet, not a code deploy; must preserve path + query
  and the `/api/integrations/` proxy exemption.
- **Lint baseline: 6 errors / 28 warnings**, all pre-existing.
- `User.passwordHash` is still a required column carrying the
  `"sso:careyos"` sentinel (auto-provisioner and seed). Dropping it is a
  migration, not a cleanup — leave it unless a schema pass is happening
  anyway.

## 6. Resume Instructions

```bash
git log --oneline -8            # 0759ee8 is the SSO deploy
npm run test && npm run typecheck
```
Read `docs/project-memory/known-issues.md` first. The SSO verification gap
that headed it is closed; what remains is config and cleanup.

## 7. Commands

```bash
npm run dev            # next dev -p 4000
npm run test           # vitest run
npm run typecheck      # tsc --noEmit
npm run lint           # eslint (NOT `next lint` — removed in Next 16)
npm run build

# Deploy — the env override is REQUIRED. The smoke test accepts only
# 200/307 and the old domain now 302s, so a bare ./deploy.sh fails at
# exit 19 *after* shipping.
KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes
KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --dry-run

# Workflow templates (idempotent; run on prod after any spec change)
ssh knuco-droplet 'sudo -u knuco bash -lc "set -a; . /etc/knuco/env; set +a; cd /opt/knuco && npx tsx prisma/seed-workflows.ts"'
```

Prod one-offs: run as user `knuco` on knuco-droplet with `/etc/knuco/env`
loaded. Migrations: `prisma migrate dev` wants to reset the dev DB — use
`migrate diff` + `db execute` + `resolve`.

## 8. Environment Variables (names only — never store values)

Required: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`.

Public host: **`APP_BASE_URL`** (falls back to `NEXTAUTH_URL`; every
outbound link is built from it).

SSO: **`CAREYOS_SSO_URL`** (default `https://app.careyos.com`),
**`CAREYOS_APP_ID`** (default `construction-crm`),
`CAREYOS_SSO_DEV_BYPASS` / `CAREYOS_DEV_EMAIL` / `CAREYOS_DEV_ROLE` —
**local dev only; the app refuses to boot if the bypass is set under
`NODE_ENV=production`.**

Optional (feature 503s when unset): `TWILIO_*`, `OUTLOOK_*`,
`MAILERSEND_API_KEY`, `EMAIL_FROM`, `OPS_ALERT_EMAIL`, `CRON_SECRET`,
`CC_ALLOCATOR_API_KEY`, `CC_ALLOCATOR_BASE_URL` + `CC_ALLOCATOR_RECON_KEY`
(read cc-allocator's postings export for the Cost Reconciliation page;
unset = the page says so),
`PHONE_ROUTING_API_KEY`, `PHONE_ROUTING_SYSTEM_USER_ID`, `ZAPIER_*`,
`TASK_ESCALATION_DAYS` (default `2,5`), `TASK_ESCALATIONS_ENABLED` (default
off; `1` to enable — after SPF), `TASK_AUTO_RULES_DISABLED` (default
`invoice.sent`; empty string enables everything),
`FIELD_ENCRYPTION_KEYS` (SSNs — without it, encrypted rows are unreadable),
`ZYLOW_API_KEY`, `ZYLOW_API_BASE`, `WORKFLOW_READY_EMAILS_ENABLED` ("1" mails
an assignee when a workflow step becomes Ready; default off, the digest
covers it), `TASK_ESCALATIONS_ENABLED`, `TASK_AUTO_RULES_DISABLED`.

## 9. Important Product / Business Rules

- **CareyOS is the identity provider.** New users are created in the
  CareyOS admin, not the CRM. Identity is keyed on **email** — a mismatch
  between portal and CRM addresses mints a second user and orphans records.
- Grants apply on the next page load, no re-login. A portal ADMIN with no
  explicit grant implicitly gets `appRoles[0]` (ADMIN).
- A CRM `User` with `isActive: false` is denied even if the portal allows.
- **Public, session-free paths** — never put these behind auth:
  `/co/*`, `/action/*`, `/api/co/*`, `/api/track/*`,
  `/api/email/unsubscribe`, `/api/integrations/*` (bearer), `/api/cron/*`
  (`CRON_SECRET`). Covered by `src/middleware.test.ts`.
- Integration convention: **503** when a server key is unset (operator
  error), **401** for a bad caller.
- CREW_LEADs are confined to `/field`; the office shell is not for them.
- **Job costs are gated by role + the `canEnterJobCosts` grant** —
  ADMIN/MANAGER/OFFICE_STAFF implicitly, anyone else by explicit grant. Use
  **explicit role lists, never `hasMinRole`**, for anything financial:
  `ROLE_HIERARCHY` ranks SALES_REP above OFFICE_STAFF (Accounting).
- **Only an APPROVED `JobExpense` moves money.** PENDING and REJECTED
  contribute nothing to `contractAmount`, `balanceDue`, the cost-plus rollup,
  job profit, the QBO export or budget allocations. Any new code that sums
  expenses must filter `status: "APPROVED"` — that is the whole control.
  Entry auto-approves for ADMIN/MANAGER/OFFICE_STAFF; everyone else queues.
  Approving is role-only and is deliberately NOT conferred by the enter grant.
- **PROGRESS jobs bill by payment application**, never by "balance due":
  amount = completed-to-date × (1 − retainage) − previous certificates. Only
  the latest application may be edited or voided. Same explicit role list
  as expense approval.
- **Workflow steps are ordinary tasks** written only through
  `createTask`/`updateTask`; a job has no workflow until someone applies
  one, and Core is never removable. Permit branches are exclusive; "No
  Permit Required" records the legal warning and needs PM approval before
  mobilization. **Blocking gates are ADMIN/MANAGER-only to skip or
  override** (audited). A template version is immutable once a job
  references it — bump the version. Own-only roles see tasks on jobs where
  they are PM, field-assigned or hold a team slot. Every open count uses
  `ACTIVE_OPEN_WHERE` (open **and** activated).
- **cc-allocator owns money that actually moved**; the CRM owns job costing
  including costs that have not moved yet. Expenses with an `externalId` are
  cc-allocator's record — ADMIN-only to delete here, and better fixed there.

## 10. Next Prompt

> Every workstream is closed and reconciliation Phase 2 is connected
> (`972affe` + cc-allocator `75078d4`). Small follow-ups if wanted, each
> pressure-tested first: (a) an **acknowledge** action on the Cost
> Reconciliation page's "missing here" list so the three intentionally
> deleted postings stop showing (record it in `ExpenseReconciliation` with
> a new decision, or a tiny sibling table); (b) a schema pass to drop
> `User.passwordHash`; (c) business-day durations in the workflow report.
> Operator items (SPF → `TASK_ESCALATIONS_ENABLED=1`, `PHONE_ROUTING_API_KEY`,
> 302→301) are Richard's. Same rules: explicit role lists, tests +
> typecheck + build green, lint ≤ 6/28, deploy with
> `KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes`.
