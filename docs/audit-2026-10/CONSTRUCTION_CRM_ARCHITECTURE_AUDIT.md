# Construction CRM — Architecture Audit (2026-10-19)

**Scope:** the KNU Construction CRM (`crm.careyos.com`) at `main` `d18ae8f`,
plus the prod database read-only on 2026-10-19.

**Baseline:** the 2026-10-02 audit (18 parts). Its whole MVP roadmap
(Foundation + 7 initiatives) shipped by 2026-10-03. Since then the CRM has
grown by GC Partnerships, Permit Intelligence (8 stages), Plan Takeoff M1–M3,
roofing, notification digests, the operations calendar, slim workflows and
vendors.

**Evidence labels:**
- **[code]**: read in the source, with a path.
- **[test]**: covered by an automated test.
- **[dev]**: observed on the dev server in headless Chromium.
- **[prod]**: a read-only count on the prod database.
- **[doc]**: the project notes only (not re-verified).

## 1. Stack and size

| Item | Value |
|---|---|
| Framework | Next.js 16.2.3 (App Router), React 19.2, TypeScript [code `package.json`] |
| Data | PostgreSQL via Prisma 7.7 + `@prisma/adapter-pg`. 169 models, 104 migrations [code `prisma/`] |
| UI | Tailwind 4, shadcn / Base UI, TanStack Query 5, cmdk (⌘K), recharts |
| Documents | `@react-pdf/renderer` (15 generated documents), `pdf-lib` (form filling), `pdfjs-dist` (reading), exceljs |
| AI | `@anthropic-ai/sdk` through one layer, `src/lib/ai` (caps, ledger, untrusted-text framing) |
| Source size | about 192k lines of TS/TSX. 467 API route files, 84 dashboard pages, 248 components |
| Tests | 223 Vitest files, 1,897 tests, all passing on 2026-10-19 [test]. Typecheck clean. Lint 5 errors / 22 warnings (the standing baseline) |
| Hosting | One DigitalOcean droplet (`knuco-droplet`), systemd unit `knuco`, port 4000. nginx + Cloudflare in front. Shared with CareyOS and about 14 sibling apps |
| Deploy | `deploy.sh`: main-only, clean tree, equal to origin. Pre-deploy DB dump + code tarball, `migrate deploy`, build on the server, smoke test, journal scan, automatic code rollback |

## 2. Architecture diagram

```mermaid
flowchart LR
  subgraph Users
    Office[Office staff\nADMIN · MANAGER · OFFICE_STAFF]
    Sales[SALES_REP · MARKETING]
    Field[CREW_LEAD\n/field]
    Customer[Customer\n/sign · /co · /action]
  end

  subgraph CareyOS
    Portal[CareyOS portal\nSSO identity + app roles]
    CCA[cc-allocator\nbank + card postings]
    PR[phone-routing\n(key unset → 503)]
  end

  subgraph CRM["KNU CRM — Next.js on knuco-droplet"]
    MW[middleware.ts\ncookie gate + public prefixes]
    Pages[App Router pages\n(dashboard) · (field) · (public)]
    API[467 route handlers\nguards: lib/access · lib/money · per-area access.ts]
    subgraph Domain["src/lib domain modules"]
      Leads[leads · nurture · follow-ups · canvassing]
      Partners[partners: GC accounts · bids · vault]
      Est[estimates · customer-contracts · roofing · takeoff]
      Jobs[jobs · workflows · tasks · calendar · crews · labor]
      Money[cost-summary · billing G702 · expenses · vendors · commitments]
      Permits[permits · permit-intel · violations]
      Notif[notifications v2 · email · attention]
      AI[ai: runAiCall · caps · AiCall ledger]
    end
    Cron[15 cron routes\nhost crontab + CRON_SECRET]
    Files[(Local disk\n/var/lib/knuco/uploads)]
    Workers[Forked workers\nPDF extract · page render]
  end

  DB[(PostgreSQL\nshared cluster)]
  MailerSend[MailerSend\nout + inbound]
  Anthropic[Anthropic API]
  Web[Public web\n(permit assistant, guarded fetch)]
  Zylow[Zylow property API]
  Zapier[Zapier / Roofr]

  Office & Sales --> MW --> Pages --> API
  Field --> MW
  Customer --> Pages
  MW -. session check .-> Portal
  API --> Domain --> DB
  Cron --> Domain
  Domain --> Files
  Est & Permits --> Workers
  AI --> Anthropic
  Permits --> Web
  Notif --> MailerSend
  MailerSend -->|ITB inbound| API
  CCA -->|expense postings| API
  API -->|postings export| CCA
  Leads --> Zylow
  Est --> Zapier
  PR --> API
```

## 3. Module inventory

Status is how far the code is built. Use is prod rows on 2026-10-19 [prod].

| Module | Purpose | Key code | Status | Use on prod |
|---|---|---|---|---|
| Auth / SSO | CareyOS portal identity, 7 roles | `src/middleware.ts`, `lib/auth/helpers.ts`, `lib/sso.ts` | Working | 7 active users |
| Access rules | Explicit role lists, own-only scoping | `lib/access/{roles,records}.ts`, `lib/money/access.ts` | Working, with gaps (§5) | — |
| Leads + pipeline | Intake, stages, boards, Mine / All | `lib/leads`, `lib/lists`, `app/(dashboard)/leads` | Working | 48 leads (20 in 30 days); 10 New, 7 Estimate Sent |
| Nurture | Follow-up + nurture cadence | `lib/nurture/*` | Built, **sending off** | settings `enabled = f` |
| Canvassing | Prospects, door knocks, Zylow, knock score | `lib/services/canvassing`, `app/(dashboard)/canvassing` | Working | 8 prospects |
| GC Partnerships | Accounts, contacts, qualifications, vault, bids, intake, health | `lib/partners/*` (16 test files) | Working | 2 organisations, 1 bid, 0 intakes |
| Estimates (roofing) | Flat roofing form estimate | `lib/estimates/calc.ts`, `components/estimates/estimates-panel.tsx` | Working, no status | 12 roof estimates |
| Estimates (sectioned) | Template sections + lines, status | `lib/estimates/generic-calc.ts`, `template-defs.ts` | Working, no prices / versions | 5, all DRAFT |
| Customer contracts | Snapshot + e-sign + money on sign | `lib/customer-contracts/*`, `/sign/[token]` | Working | **0 contracts** |
| Roofing library | Roofr parse, measurements, rules, price book | `lib/roofing/*` | Working, **not connected to estimates** | 1 measurement, 0 materials (import not applied) |
| Plan takeoff | Plan sets, sheets, calibration, measurements, AI roofing (M1–M3) | `lib/takeoff/*` | Working to measurements; M4–M6 not built | 1 plan set, 1 takeoff |
| Jobs | Job page (20 tabs), Overview, health, stages | `lib/jobs/*`, `app/(dashboard)/jobs/[id]` | Working | 27 jobs, 19 open, 10 created in 30 days |
| Workflows | Templates, compose / apply / reconcile, gates, catch-up | `lib/workflows/*` (32 test files) | Working | 14 instances; 57 steps completed in 30 days |
| Tasks | One task model, dependencies, digests, escalations | `lib/tasks/*` | Working | 69 active overdue, 15 unassigned |
| Calendar | Day / Week / Month / People, overlays, drag | `lib/calendar/*` | Working | — |
| Field | Field mode, daily logs, labor entries, crews | `app/(field)`, `lib/labor`, `lib/crews` | Working, **little used** | 1 daily log in 30 days (last 2026-09-25) |
| Job cost | One cost calculation, commitments, budgets | `lib/jobs/cost-summary.ts`, `lib/services/job-cost.ts` | Working | Budgets on 3 jobs |
| Billing | Lump-sum invoices, G702 / G703, retainage, payments | `lib/billing`, `lib/services/progress-billing.ts` | Working | 29 invoices, 5 payments in 60 days |
| Expenses | Approval states, receipts, cc-allocator intake, twin guards | `lib/expenses/*` | Working | 61 expenses in 30 days, 0 pending |
| Labor contracts | Crew contracts, payments, requests | `lib/labor/*` | Working | 9 contracts, 11 payments in 30 days |
| Vendors | Directory, payee match, compliance, commitments | `lib/vendors/*` | Working, **directory empty** | 0 vendors |
| Permits | Job permits, inspections, alerts, Permit Center | `lib/permits/*` | Working | 4 permits (3 issued) |
| Permit Intelligence | Record, corrections, forms, NOA, preflight, lessons, assistant | `lib/permit-intel/*` (about 7.7k LOC) | Working, **security bug** (§5) | 2 assistant runs, 1 form template |
| Code violations | Cases, deadlines, hearings, fines, closure | `lib/violations/*` (about 5k LOC) | Working; Stage 4 reports not built | 4 cases |
| Notifications | Bell, v2 digests, preferences | `lib/notifications/*` | Working, **delivery on** | 76 digests sent; settings `enabled = t` |
| Attention dashboard | 20 role-aware "needs attention" rows | `lib/attention/*` | Working | — |
| Reports | Funnel, labor, workflow, collections, partner analytics | `app/(dashboard)/reports`, `collections` | Working, partial (§6) | — |
| AI layer | Capped, audited model calls | `lib/ai/*` | Working | $0.56 spent in total |
| Files | Disk store, preview, missing, job / permit / expense links | `lib/files/*` | Working | 33 uploads in 30 days |

## 4. Integrations

| Integration | Direction | State |
|---|---|---|
| CareyOS SSO | in | Live; every request is checked against the portal (`lib/sso.ts`) |
| cc-allocator | both | Live: expense postings in (idempotent on `externalId`), postings export read for reconciliation |
| MailerSend | both | Outbound live. Inbound ITB route built, off until `MAILERSEND_INBOUND_SECRET` is set. Plan rejects custom headers |
| Anthropic | out | Live, $5 per subject / $100 per month caps |
| Zylow | out | Live, read-only, cached |
| Zapier / Roofr | both | Roofr order out, signed callback in |
| QuickBooks | out | **CSV export of approved expenses only**, one job at a time, Account column blank. No API sync |
| Twilio SMS | both | Provider code present, **not configured**. `/api/messaging` behind SSO (ruled: leave for now) |
| Outlook (Graph) | in | Poller code present, **not configured** |
| Phone routing | in | Deployed, key unset → 503 |

## 5. Architectural concerns and technical debt

Ranked by risk. Each item is confirmed in the code unless marked otherwise.

1. **SSRF gap in the permit assistant's web fetcher.** It is on prod. `lib/permit-intel/web-fetch.ts:49-66` `isBlockedAddress` recognises only the dotted `::ffff:a.b.c.d` form. `new URL()` rewrites `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, which is **not blocked**. Neither are `[::ffff:7f00:1]` (localhost), `[::7f00:1]` or `[2002:a9fe:a9fe::]` (6to4). Because the host is an IP literal, `safeLookup` never sees it. Verified by running the module's own functions on 2026-10-19 [test, temporary]. A link planted in an uploaded document, or one hop from it, could reach the droplet's metadata service or local services on ports 80 / 443. **Fix first.**
2. **Object-level read gaps on money documents.** `api/invoices/[id]/pdf` and `api/payments/[id]/receipt` check only for a session and load the record by id [code]. Any signed-in user, crew lead included, can fetch any invoice or receipt. Other session-only reads:
   - `api/jobs/[id]/field-assignments` GET (field users' emails for any job id) [code]
   - `api/door-knock-routes/[id]` PATCH / DELETE (reported by an agent, not re-read)
3. **Margins reach own-only roles.**
   - `GET /api/jobs/[id]/overview` and `/cost-summary` use only `guardJob(read)` [code], so a crew lead on a job receives contract value, profit and crew payments.
   - Meanwhile `canSeeLaborCosts` (`lib/labor/permissions.ts`) hides hourly cost from the same person. The two rules contradict each other.
   - The 2026-10-02 Foundation pass left money *reads* open for SALES_REP on purpose. CREW_LEAD and MARKETING were not considered.
4. **Approved money can change without review or audit.**
   - Expense PATCH (`api/expenses/[id]/route.ts:55-138`) is open to anyone holding the per-user `canEnterJobCosts` grant. It edits the amount / billable flag of an APPROVED row, which moves a cost-plus contract, with no re-approval and no AuditEvent [code].
   - Lump-sum invoice PATCH, SOV / applications, budget import (which deletes every line and its allocations), labor contract edits and change-order decisions also lack AuditEvents (agent report; spot-checked for expenses).
5. **Change-order approval race.** `lib/services/change-orders.ts:236-259` checks the status outside the transaction, and the final `update` (`:529`) has no `where status` condition [code]. A customer approval and an internal approval landing together could raise the contract twice and create two invoices. Unlikely, but money-moving.
6. **Estimate cost baseline is read live and incomplete.**
   - `services/job-cost.ts:63-71` reads `estimate.subtotalCost` at query time [code], and the template-estimate PUT does not lock an ACCEPTED estimate [code]. Editing an estimate after signing moves the job's projected profit.
   - Optional items a customer chose are priced into the contract (`customer-contracts/snapshot.ts:75-100`) but excluded from cost (`estimates/generic-calc.ts:60-62`) [code]. Margin is overstated.
7. **Hard-coded stage sync.** `lib/workflows/stage-sync.ts` maps step keys to stage **names as strings** and looks them up with `findFirst({ name })`. Renaming a stage in admin silently stops stages from following the workflow, and the error is swallowed (agent report, consistent with the code read).
8. **Overlapping task generators.** These all create tasks:
   - workflow steps
   - stage `JobTaskTemplate`s (still fired by `changeJobStage` on workflow-driven moves)
   - `auto-tasks.ts`
   - the retired FollowUpRule admin, still routed at `api/admin/follow-up-rules`

   The duplicate-task risk is managed by `skipWhenWorkflow` flags, not by design.
9. **Two estimate systems.** `RoofEstimate` (flat form, no status) and the sectioned `Estimate`. This doubles the PDFs (`lib/pdf/estimate.tsx` 1,001 lines + `generic-estimate.tsx` 782), the contract branches and the bid pickers.
10. **Tests stop at the library.** None of the 223 test files cover route handlers or components (`*.test.tsx` is excluded). The authorisation gaps in items 2–4 cannot be caught by the suite.
11. **Local-disk file store, backed up on the same droplet.** It lost 190 files once (2026-10-02). There is no off-box copy.
12. **Navigation sprawl.** The sidebar has 45 entries (`components/layout/sidebar.tsx`), 17 of them admin. The 2026-09-25 UX stage had cut it to 11, and CLAUDE.md still says 11.
13. **Client fetch hygiene.** 204 raw `fetch(` calls in 56 client files, against 246 `fetchJson(` calls. Errors can be swallowed (the cause of the 2026-08 "deleted jobs" scare).
14. **Large client panels.** `labor-contracts-panel.tsx` 1,523 lines, `expenses-panel.tsx` 1,313, `estimates-panel.tsx` 1,206, `invoices-panel.tsx` 967.
15. **Legacy leftovers.**
    - `middleware.ts` should be named `proxy.ts` in Next 16.
    - `NEXTAUTH_*` is still required in the env.
    - `@auth/prisma-adapter` looks unused.
    - `lib/services/messaging/twilio-placeholder.ts` is dead code.
    - `lib/services/*` overlaps the per-domain modules.
    - `getFinancialSummary` (`services/financials.ts:136-212`) is a second profit formula, computed per request and never shown.

## 6. Shared dependencies with CareyOS

- **Identity:** the portal is the only identity provider. Grants are keyed on email; a CRM `isActive = false` still denies.
- **Same droplet and Postgres cluster** as CareyOS and about 14 apps. `max_connections` was raised to 250 after two outages; the CRM pool has a minimum of 2 connections.
- **cc-allocator** owns money that actually moved. The CRM owns job costing. The two reconcile through the Cost Reconciliation page.
- **No shared npm packages.** The CRM is deployed alone (systemd, not pm2).

## 7. What is architecturally sound (keep)

- **One cost calculation** (`computeCostSummary`) fed by one loader that filters on APPROVED / RECEIVED.
- **`recomputeJobBalance`** is the only writer of a job's balance; deposits are derived from payments.
- **Workflow engine:** pure planner, idempotent apply, nothing deleted on migration, explicit role lists, 32 test files.
- **AI layer:** no tools, schema-checked answers, untrusted-text framing, caps, a ledger row per call, a person confirms every proposal.
- **Notification v2:** classification, digests, a dedupe ledger, a DB switch that is instant to turn off.
- **Deploy discipline:** backups, rollback, smoke test, journal scan.
- **Attention rows:** each row's count and list share one `where` builder.
