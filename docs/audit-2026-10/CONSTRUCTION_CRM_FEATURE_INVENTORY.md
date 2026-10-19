# Construction CRM — Feature Inventory (2026-10-19)

Every functional area, what exists, and how it was verified.

**Status:**
- **Working**: complete in code for its purpose.
- **Partial**: works, but with material gaps.
- **Built-off**: complete, but switched off or unconfigured on prod.
- **Orphaned**: code exists that nothing reaches.
- **Missing**: does not exist.

**Evidence:**
- **T**: covered by automated tests (1,897 passing on 2026-10-19).
- **D**: seen working on dev in headless Chromium (2026-10-19 page sweep, desktop + 400 px).
- **P**: prod row counts on 2026-10-19 (read-only).
- **C**: read in code (path given; not executed).
- **B**: blocked from verification (named reason).

No customer was contacted and no prod data was changed.

**Page sweep (D):**
- Admin: 37 pages × 2 widths, 74 page loads; **0 page errors, 0 failed loads, 0 horizontal overflow at 400 px**.
- Other roles: see the role table in `CONSTRUCTION_CRM_UX_AUDIT.md` §2.
- Load times are dev-mode first compiles: up to 4.4 s for a job page.

---

## A. Leads and sales pipeline

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Manual lead entry | Working | C `api/leads/route.ts:87-178`; D `/leads/new`; T | Writes stage history and activity, fires the lead event |
| Phone-routing intake | Built-off | C `lib/integrations/phone-routing/lead-service.ts`; P key unset → 503 | Fills the address with "TBD / 00000"; no assignee |
| Google Ads email (Outlook poller) | Orphaned | C `lib/services/intake/intake-service.ts:129`; P 0 events | `OUTLOOK_*` unset; nothing schedules it; skips `emitLeadEvent` |
| Prospect → lead promote | Partial | C `api/prospects/[id]/promote/route.ts:47` | No duplicate check; the knock score and notes are dropped |
| Duplicate detection | Partial | C `api/leads/route.ts:107-121`, `api/leads/contact-lookup` | Warns only. Exact strings with **no phone normalisation**. `Lead.duplicateGroupId` is never written. No merge |
| Assignment | Partial | C `api/leads/[id]/assign` | `PATCH /api/leads/[id]` also sets the assignee, with no history row or event, and a SALES_REP can do it |
| Source tracking | Partial | C `api/reports/route.ts:85-89` | gclid is not stored on the lead; no offline-conversion upload |
| Lead scoring | Missing for customer leads | C `services/canvassing/score.ts` | The knock score exists for canvassed properties only |
| Stages, board, Mine / All | Working | T, D `/leads` | 7 stages in use (P: 10 New Lead, 7 Estimate Sent, 27 Won) |
| Follow-up due date | Partial | C `attention/rows.ts:120`; P **20 open customer leads past their follow-up date, 19 never contacted** | Logging a contact does not move the date (ruled 2026-10-19: keep it so). `/leads` has no "due" filter or sort |
| Follow-up rules engine (legacy) | Built-off | C `lib/follow-ups/processor.ts`; doc: the processor was never on the crontab | Checks email opt-out (`:165`), not a closed stage |
| Customer nurture cadence | Built-off | T `lib/nurture/*`; P `nurture_settings.enabled = f` | Waits on SPF (the duplicate SPF record is still in DNS) |
| Inbound SMS | Partial | C `api/messaging/route.ts` | Twilio not configured; unknown senders dropped; no STOP handling |
| Referrals | Orphaned | C nothing calls `POST /api/referrals` | The page lists and edits; nothing creates |
| Reviews | Partial | C `services/jobs.ts:269-312` | Created on job close; `/api/reviews` has no UI |
| Rep performance | Partial | C `api/reports/route.ts:90-97` | Lead counts per rep only (no win rate, revenue or speed) |
| Funnel | Working | T `reports/funnel.ts` | `?type=conversions` is not role-scoped |
| Response-time dashboard | Orphaned in effect | C `tracking/tracked-links.ts:93` | Fed only by the dormant email intake |
| Canvassing (prospects, knocks, routes, Zylow) | Working | D `/canvassing`; P 8 prospects | Door-knock-route and property-refresh routes are session-only |

## B. Estimating and proposals

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Roofing estimate (`RoofEstimate`) | Partial | C `lib/estimates/calc.ts:69-125`, `estimates-panel.tsx`; P 12 | Flat form, one lump material cost, **no status, no versions**; does not read roof measurements |
| Sectioned estimate (`Estimate`) | Partial | C `generic-calc.ts`, `template-defs.ts`; P 5, all DRAFT | 4 templates (no plumbing, no commercial); **templates carry no prices**; no cost-type split; no overhead line |
| Margin math | Working | T `calc.ts:91`, `generic-calc.ts:89` | True margin `cost / (1 − m)`. The "Unit price" label invites double margin; sales tax is applied to the whole price |
| Versioning / lock after acceptance | Missing | C `template-estimates/[estimateId]/route.ts` PUT has no status check | An accepted estimate stays editable |
| Send estimate to customer | Missing | C status only (`estimate-status.ts`) | "Mark sent" is manual. No email, link or view tracking |
| Customer contract + e-signature | Working | T `lib/customer-contracts/*`; P **0 contracts ever** | Snapshot + sha256, single-use signing, money applied on sign |
| Change orders (customer + crew) | Working | T; C `services/change-orders.ts` | Token approval → invoice or SOV line. Approval race (see the architecture audit §5.5) |
| Estimate → job price | Partial | C `services/jobs.ts:62` | Won uses the hand-typed `estimatedJobValue` (or $0); the estimate total arrives only by a signed contract |
| Estimate → budget | Missing | C no estimate reference in `lib/budget` | Budgets by hand or CSV (P: 3 jobs have one) |
| Estimate cost → job baseline | Partial | C `services/job-cost.ts:63-71`, `cost-summary.ts:93` | Read live (moves if the estimate is edited); leaves out chosen optional items; change-order cost not added |
| Roofing price book + rules engine | Working, not connected | T `lib/roofing/*`; C `previewTakeoff` called only from Admin → Roofing | The import's dry run plans 40 materials (not applied) |
| Roof measurements (Roofr) | Working | T; P 1 | Not read by any estimate |
| Plan takeoff M1–M3 | Working | T; D (M3 re-QA'd 2026-10-19); P 1 plan set | Stops at measurements |
| Plan takeoff M4–M6 (plumbing, materials, RFQ) | Missing | C `takeoff/[takeoffId]/page.tsx:37` placeholder | Planned |
| Historical cost library | Missing | — | Spend per vendor only |
| Sub bid packages / comparison | Missing | C nothing outbound | `BidInvitation` is GC → KNU only |

## C. Projects and jobs

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Job page (20 tabs) + Overview | Working | D all tabs swept; C `lib/jobs/overview.ts` | The Overview lacks field issues, crews, budget variance and a projected finish |
| Health (On track / At risk / Delayed) | Working | T `lib/jobs/health.ts` | Shown on the job only; no list of delayed jobs |
| Stage follows workflow | Working, fragile | T; C `workflows/stage-sync.ts` | Stage names hard-coded as strings |
| Workflow templates + engine | Working | T (32 files); P 14 instances, 57 steps done in 30 days | Mature |
| Tasks | Working | T; P 69 active overdue (Lisette 32, Erica 11, unassigned 10), 15 unassigned | Task volume is real; overdue debt is high |
| Manual task dependencies | Working | C `api/tasks/[id]/dependencies` | — |
| Recurring tasks | Missing | — | Deferred in the calendar plan |
| Punch list as items | Missing | C v2 `core.ts:140` checklist line only | — |
| Closeout documents | Partial | C checklist lines on `close_job` | Nothing checks that they exist |
| Warranty tracking | Missing | C roof-estimate warranty fields only | No dates, claims or callbacks |
| Project contacts (architect, owner rep, inspector) | Missing | — | People are PM / rep / team slots only |
| Customer portal | Missing | — | Customers see only signing / CO / action links |
| Gantt / job timeline | Missing | C `CalendarView` DAY / WEEK / MONTH | — |
| Daily logs + field mode | Working, little used | T, D `/field`, `/field/day`; P **1 daily log in 30 days** | — |
| Crews + install dates | Partial | C `CrewAssignment.installDate` (one day, no duration) | All-day double-booking never flagged |
| Field issues | Working | C `FieldIssue` | No PUNCH type |

## D. Permits

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Job permits + inspections, one record | Working | T `lib/permits/*`; P 4 permits | Inspection result writes are not in one transaction |
| Failed inspection → correction task | Working, with caveats | C `permits/service.ts:268-323` | No owner when a job has no PM / superintendent / coordinator; a re-inspection is not prompted; CREW_LEAD cannot record a result |
| Permit Center (board, list, inspections, aging, metrics) | Working | D `/permits` | Three different "late" thresholds; `inReview` ignores IN_PROGRESS; counts closed jobs |
| Permit record (11 tabs) | Working | D | Three places edit a permit (job tab, drawer, record) |
| Jurisdictions + requirements | Working | D `/admin/permits`; P 4 jurisdictions | Department websites not filled in |
| Frozen submissions | Working | T | — |
| Correction letters read by AI | Working | T; doc dev QA | Highest-value AI feature |
| Fillable + flat forms | Working | T; P 1 template, 2 fills | The flat path is complex for this volume |
| Product approvals (NOA / FL) | Working | T; P 1 | — |
| Preflight | Working | T | Overlaps the requirements checklist |
| Lessons + metrics | Working, idle | T | Needs volume; 4 permits on prod |
| Document assistant (web) | Working, **security gap** | T + C `web-fetch.ts:49-66` | IPv6-mapped literal addresses bypass the private-address check (verified) |
| Permit fees | Working (shown only, by ruling) | C | — |
| Municipal portal integration | Missing (correct for the volume) | — | — |

## E. Calendar, scheduling and tasks

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Day / Week / Month / People views | Working | T, D `/calendar`, `?view=people` | — |
| Drag to schedule, conflict warning | Working | T `lib/calendar/conflicts.ts` | Timed tasks only |
| Overlays (permits, hearings, installs, starts) | Working | T | — |
| Digest windows (4 a day) | Working, **live** | P 76 digests sent, last today | Earlier notes said "shadow"; prod settings show delivery on |
| Escalation of overdue tasks | Built-off | C env `TASK_ESCALATIONS_ENABLED=0` | Waits on SPF |
| Admin oversight of everyone's work | Partial | D Calendar → People | No overdue-by-person view (P shows it is needed) |
| Workflow role defaults | Built-off | P **0 defaults set** | Unowned steps stay unowned |

## F. Subcontractors and vendors

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Vendor directory + payee matching | Working, **empty** | T; P 0 vendors | The Unmatched tab is waiting |
| Compliance docs (COI, WC, W-9, licence) + expiry | Working | T; cron installed | Warns, never blocks (ruling) |
| Commitments | Working | T | No PO document (ruling) |
| Labor contracts + payments + requests | Working | T; P 9 contracts, 11 payments in 30 days | No audit on contract edits; no overpayment guard |
| Crew double-count guard | Working | T `lib/expenses/labor-cover.ts` | "Record as payment" is two writes, not a transaction |
| Sub performance | Missing | — | — |
| Sub bid invitations / comparison | Missing | — | — |
| Lien waivers | Missing | — | — |

## G. GC business development

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Accounts, contacts, interactions, follow-ups | Working | T (16 files); P 2 organisations, 1 contact, 1 interaction | Barely used |
| Qualifications + document vault + package | Working | T; P 16 doc types | — |
| Bid invitations, go / no-go, submissions, award → job | Working | T; P 1 bid | Bid price typed by hand; award has no cost baseline |
| Bid intake (paste / MailerSend inbound) | Partial | P 0 intakes; inbound secret unset | — |
| Health score, scorecard, analytics | Working | T | — |
| BuildingConnected, discovery, AI | Missing (deferred) | doc | — |

## H. Code violations

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Intake, cases, queues, workflow template | Working | T (12 files); D `/violations`; P 4 cases | — |
| Deadlines, reminders, hearings, agency inspections, fines, closure guard | Working | T | — |
| Escalation chain | Built-off | env `VIOLATION_ESCALATIONS_ENABLED=0` | — |
| Stage 4 reports / dashboard | Missing | C `canViewViolationReports` has no callers | Not needed at 4 cases |

## I. Money and job cost

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| One job cost calculation | Working | T `cost-summary.ts` | Progress jobs understate billed-to-date by the retainage |
| Budgets + allocations | Partial | C `budget/import/route.ts:45` | Import deletes all lines and allocations, with no audit; per-line actuals ignore expense status |
| Expenses + approval + receipts | Working | T; P 61 in 30 days | Approved rows editable by grant holders with no audit |
| cc-allocator intake + reconciliation | Working | T; P 3 acknowledged | Bearer key compared with `!==` |
| Lump-sum invoices | Partial | C `api/invoices/[id]` | Editable after SENT / PAID; no audit; P 29 invoices |
| Progress billing G702 / G703 + retainage | Working | T; P 3 invoices on JOB-00009's chain | Excellent |
| Payments, deposits, A/R | Working | T; P 5 in 60 days | A payment not linked to an invoice does not close it |
| Collections page | Partial | C `collections/page.tsx:150-152` | "Total collected" = contract − balance (wrong for owned rehab); stops at 500 jobs |
| Budget-overrun alerts | Missing | C no attention row | Red cell on Collections only |
| Cash-flow forecast | Missing | — | — |
| Purchase orders | Missing (by ruling) | — | Commitments stand in |
| QuickBooks | Partial | C CSV of approved expenses | No invoices, payments, payroll or API |

## J. Documents

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Files on lead / job / task / expense / permit / case | Working | T, D | 14 categories |
| Preview, missing marker, upload again | Working | D | 190 old files still missing |
| Photos gallery (two sources, EXIF dates) | Working | D | — |
| Versioning | Partial | C vault and generated docs only | Ordinary files are not versioned |
| Search | Partial | C ⌘K over records; full text over permit PDFs only | Files, estimates and invoices are not searchable |
| Company vault (encrypted RESTRICTED docs) | Working | T | — |
| AI document extraction | Working (permits, NOAs, forms) | T | Not for COIs, invoices or plans beyond roofing |

## K. Dashboards and reports

| Feature | Status | Evidence | Notes |
|---|---|---|---|
| Needs attention (20 role-aware rows) | Working | T; D | Count and list share one `where` |
| Today / My tasks / Workflow health | Working | D | — |
| Sales tiles + charts | Working | D | No pipeline value (`estimatedJobValue` never summed) |
| Reports (funnel, stages, sources, reps, workflow, labor) | Working | D `/reports` | Rep metrics are counts only |
| Collections + projected profit | Partial | D | Office roles; totals bug above |
| Partner analytics, Permit Center metrics, AI usage | Working | D | — |
| Owner's 60-second questions | Partial | See the UX audit §4 | 4 of 13 answered on one screen |

## Orphaned or dead code (candidates to delete)

- `Lead.duplicateGroupId` (never written)
- `POST /api/referrals` and `/api/reviews` (no callers)
- `canViewViolationReports` and `violationDashboardScope` (no callers)
- `lib/services/messaging/twilio-placeholder.ts` (only throws)
- `getFinancialSummary` profit block (computed, never shown)
- Response-time dashboard (fed only by the dormant intake)
- Redirect-only pages `/schedule`, `/production`, `/pipeline` (keep as redirects)
- FollowUpRule admin (rules retired; the routes are still live)
