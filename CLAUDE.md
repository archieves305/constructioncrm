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
1. 🔴 **Progress billing** — deployed + JOB-00009 backfilled 2026-08-27;
   apps 1–12 PAID, apps 13–14 to be entered in the UI. Next: Stage 2
   (change orders on PROGRESS jobs add an SOV line instead of an invoice).
2. 🔴 **Job-costing check-and-balance.** Write gate and pending state both
   shipped. Remaining: **reconciliation against cc-allocator**, and **12
   candidate duplicate charges ($9,166.20) still need a human to confirm** —
   see [known-issues.md](docs/project-memory/known-issues.md).
3. Confirm `field-log-digest` self-healed on its next 7:00am run — it had
   been failing for all four `@calibertrust.com` users under the old
   MailerSend cap, which is now lifted.
3. Add the SPF record for `knuconstruction.com` (see §5).
3. Set `PHONE_ROUTING_API_KEY` to activate the phone-routing integration.
4. Dead-code cleanup from the auth swap.
5. Promote the old domain's 302 → 301 — **deliberately parked**, not
   blocked (see §5).

The SSO cutover is **done and verified**; jgarcia's role is **decided**.

## 4. Session Log (latest — full history in [session-history.md](docs/project-memory/session-history.md))

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
- Dead code: `lockout*`, `password-policy`, `admin/users` password path,
  `next-auth` in package.json.
- **Lint baseline: 6 errors / 29 warnings**, all pre-existing.
- Lead detail, jobs list and leads list still fetch `/api/admin/users`
  (ADMIN/MANAGER only) for their assignment dropdowns — empty for other
  roles. Task pickers moved to `/api/users/assignable`; these did not.

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
`CC_ALLOCATOR_API_KEY`,
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

> Trade Workflow Templates Stage 1 is deployed and seeded on prod. Build
> **Stage 2** per the plan in
> `docs/project-memory/features/workflows.md` ("Not yet"): full
> `reconcile.ts` (permit REQUIRED↔NOT_REQUIRED with a reason, add/remove
> trade, version upgrade — each with a preview that lists To add / To skip
> / Kept, never deleting completed or manual tasks), `inspections.ts`
> (PASS / FAIL / CONDITIONAL, correction tasks, re-request), template
> versioning (`createDraft`, `validateVersion`, `publishVersion`) and the
> Workflow Template Library editor at `/admin/workflow-templates/[id]`
> with no raw JSON. Keep every task write through `createTask`/`updateTask`,
> explicit role lists, tests + typecheck + build green, lint ≤ 6/29, deploy
> with `KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes`.
