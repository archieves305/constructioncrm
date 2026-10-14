# CareyOS Construction CRM — GC Partnerships Implementation Plan

_Written 2026-10-13 after a plan-mode audit of the codebase (three exploration
passes, two design reviews, read-only). Nothing in this document is built. No
migration exists. The plan file that was approved is
`~/.claude/plans/noble-forging-noodle.md`; this document is its long form._

The module's purpose: turn GC relationships into recurring bid invitations,
awarded projects and profitable repeat work, and let management see which
relationships are worth the time. It is a business-development, bid-intelligence
and relationship-profitability system inside the CRM — not a database of
general contractors and not a second CRM.

---

## 1. Executive summary

**What exists.** The CRM has no Company, Contact, Opportunity, Bid or Market
concept. The customer is the `Lead` row (one person plus one property address).
Every downstream record — both estimate families, plan takeoffs, Roofr
measurements, files, communications, customer contracts and the Job — requires a
`leadId`, and `createJobFromLead` creates one job per lead. The one GC project
on prod today (JOB-00009, the $832,500 Towne Place Suites drywall package for
Coastal Choice Construction, AIA progress-billed with 10% retainage) was imported
exactly as a Lead carrying the GC's name as `companyName` with
`propertyType COMMERCIAL` — so the "GC project = Lead" pattern is already in
production. `Vendor` is the only external-company record, but it is payee-side
(its name is matched against expense payees; SALES_REP cannot see it), so it is
the wrong home for a customer-side GC. What the vendors module does give us is
the engine to copy: compliance derived from documents on read, and tasks raised
once per key and settled by the record.

**What the module adds.** A new `src/lib/partners/` module with five genuinely
new entities — `Organization` (any strategic external company, with its
relationship stage, owner, markets, trades and GC profile columns), `Contact`,
`Interaction`, `Qualification` with a requirement checklist over an
admin-editable `CompanyDocumentType` list, and the KNU document vault
(`CompanyDocument`) — plus two small extensions that make bids first-class
without a second pipeline: `Lead.kind` (`CUSTOMER | GC_BID`) with
`organizationId`/`contactId`, and a 1:1 `BidInvitation` + append-only
`BidSubmission` on the bid lead. A bid invitation is therefore a lead the
estimators, takeoff, files and tasks already know how to work; award moves the
lead to Won and the existing job creation runs with progress-billing defaults.

**Scoring and automation are deterministic.** A relationship health score and a
bid/no-bid score are pure functions over stored facts with versioned,
admin-editable weights; follow-up rules raise ordinary tasks and settle when an
interaction is logged; the scorecard reads the one job-cost calculation and the
invoice/payment tables. AI, when it arrives, explains a score or drafts a
follow-up — it never contributes a point.

**MVP.** Stage 1 alone is useful in a week: the target list with owner, stage,
last touch and overdue follow-up tasks, with Coastal Choice backfilled and GC
leads fenced off from customer nurture and sales KPIs. Stages 2–4 (prequal +
vault, bids, scorecard) follow in roughly a day to two each, matching the pace
of the vendors and violations modules. Email ITB intake, platform integrations,
opportunity discovery and the AI assistant are later phases.

---

## 2. Current CareyOS architecture (as relevant here)

Next.js 16.2.3 App Router + Prisma 7 / PostgreSQL, one app on the knuco droplet
(`/opt/knuco`, systemd unit `knuco`, port 4000, `crm.careyos.com`). CareyOS SSO
is the identity provider; seven roles (`ADMIN, MANAGER, SALES_REP, OFFICE_STAFF,
MARKETING, READ_ONLY, CREW_LEAD`); every route answers to an explicit role list
(never `hasMinRole`). 135 Prisma models today.

| Concern | Where it lives | Facts that matter for this module |
|---|---|---|
| Customer | `Lead` | Person + one property; required `firstName, lastName, primaryPhone, propertyAddress1, city, zipCode`; `companyName` free text; `propertyType RESIDENTIAL\|COMMERCIAL`; `sourceId → LeadSource` (DB table); `currentStageId → LeadStage` (DB table with `isWon/isLost/isClosed`); `services → ServiceCategory` via `LeadService`; `lastContactAt`, `nextFollowUpAt`, `estimatedJobValue`, `assignedUserId`. |
| Lead → Job | `src/lib/services/jobs.ts` `createJobFromLead` | Idempotent per lead; sets `contractAmount = estimatedJobValue`, **50% deposit**, stage "Deposit Needed", `salesRepId`, applies the workflow (`auto-apply.ts`); never sets `billingMethod`. Called from `src/app/api/leads/[id]/stage/route.ts` when the new stage `isWon`. |
| Job | `Job` | No address (the lead's); `jobType FIXED_PRICE\|COST_PLUS\|OWNED_REHAB`; `billingMethod LUMP_SUM\|PROGRESS`; `retainagePercent`; `projectManagerId`, `salesRepId`; `dailyReportRecipients[]`. |
| Estimates | `Estimate` (sectioned, `EstimateStatus DRAFT/SENT/ACCEPTED/DECLINED`, `subtotalCost`, `totalPrice`, `marginPercent`, `exclusions`) and `RoofEstimate` (no status) | Both require `leadId`; combined UI `src/components/estimates/lead-estimates-panel.tsx` on lead and job pages; `onEstimateTransition` raises/closes the follow-up task. |
| Takeoff | `PlanSet`, `Takeoff` (`TK-nnnn`), `TakeoffMeasurement` | Require `leadId`; `TakeoffTrade ROOFING\|PLUMBING`. |
| Contracts | `CustomerContract` | Requires `jobId` and exactly one accepted estimate; signing sets `Job.contractAmount`/`originalContractAmount`. |
| Vendors | `src/lib/vendors/*` | `Vendor` (kind, trade, one inline contact), `VendorDocument` (type enum, carrier, policy, effective/expiry, own storage columns), pure `compliance.ts`, `alerts.ts` + `alert-run.ts` (raise once per `sourceKey`, settle on write), `VendorSettings` singleton owner. |
| Files | `File`, `src/lib/files/*` | Parent FKs `leadId, jobId, taskId, expenseId, violationCaseId, violationItemId`; `FileCategory` enum; `fileReadWhere` scopes own-only roles; generated documents protected; no versioning, expiry or confidentiality. |
| Tasks | `Task`, `src/lib/tasks/*` | FKs `leadId, jobId, estimateId, invoiceId, prospectId, dailyLogId, vendorId, violationCaseId, violationItemId`; `sourceKey` (indexed); `createTask`, `updateTask`, `closeAutoTask`; subject labels in `src/lib/labels/subject.ts`. |
| Activity | `Communication` (SMS/CALL/EMAIL, requires `leadId`, message-shaped), `ActivityLog` (requires `leadId`), `CodeViolationEvent` (case-scoped ledger) | No org-scoped interaction exists. |
| Calendar | `src/lib/calendar/{types,overlays,overlays-load}.ts` | `CalendarKind` union; overlay kinds each need a row type, loader, icon. |
| Attention | `src/lib/attention/{rows,load}.ts` | A row = key + role list + one `where` shared by count and list. |
| Notifications | `src/lib/notifications/*` | v2 in shadow; kinds registry; tasks already notify on assignment. |
| Audit | `src/lib/audit/record.ts` `recordAudit` | `entityType/entityId/action/before/after`, never throws. |
| Reports | `/api/reports?type=…`, `src/lib/reports/*`, `src/lib/services/financials.ts`, `src/lib/services/job-cost.ts` | `getJobCostRows(where)` = per-job revenue/cost/profit from the one calculation; AR aging; only from/to date inputs, no presets. |
| Money dates | `Invoice{issueDate, dueDate, paidAt}`, `Payment{receivedDate, invoiceId?}` | Days-to-pay derivable; `receivedDate` defaults to entry time; deposits often unlinked. |
| Scoring precedent | `src/lib/services/canvassing/score.ts` + `scoring-config.ts` | Pure, config JSON in a settings singleton, clamped 0–100, tested. |
| Health precedent | `src/lib/jobs/health.ts` | Derived on read with reasons, never stored. |
| Email | MailerSend outbound (`src/lib/email/*`); Outlook Graph inbound intake parses Google Ads lead mail only (`src/lib/services/intake/*`, `InboundEmailEvent`, `IntakeSettings.allowedSenders`) | No general inbound association. |
| AI | Uncommitted takeoff work only (`src/lib/takeoff/ai/*`: cached, cost-capped `runAiCall`, `PlanAiCall` table) | Bound to takeoffs. |
| Background jobs | `src/app/api/cron/*` behind `requireCronSecret`, droplet wrappers in `/home/knuco/crm-cron/` | 13 routes; no queue library. |
| Module template | Code Violations (`src/lib/violations/*`, `src/app/(dashboard)/violations/*`, `src/components/violations/*`) | Access with explicit role sets + `casePermissions`, sequence numbering, sidebar section, tabs in the URL. |
| Mobile | Office pages responsive (QA at 400 px); `(field)` route group for CREW_LEAD | No PWA. |

---

## 3. Existing components that can be reused

**Unchanged**
- `Task` + `createTask` / `updateTask` / `closeAutoTask`, `OPEN_TASK_STATUSES`, reminders, escalations, the overdue attention row and the calendar — the whole "next action" machine.
- `File` rows on the bid lead (ITB, plans, addenda, the submitted bid PDF) through `POST /api/files` with `leadId`, `FilePreviewDialog`, `FileLink`, the missing-on-disk state.
- Both estimate builders, the plan takeoff module, Roofr measurements — they attach to the bid lead with zero change.
- `createJobFromLead` (with an options argument, §15), `JobStage`, workflows, the job Overview and Money tabs.
- `getJobCostRows` / `computeCostSummary` for per-GC revenue, cost, projected profit and margin; `getArAging`; `Invoice`/`Payment` for days-to-pay.
- `recordAudit`; the field-encryption keyring (`src/lib/crypto/field-encryption.ts`); `requireCronSecret` + droplet cron wrappers; `validateBody` + zod; `fetchJson` + TanStack Query hooks; `PageHeader`, `EntityHeader`, `StageStepper`, `StagePillSelect`, `ListToolbar`, the kanban kit, `EmptyState`, `KpiCard`, recharts, `toCsv`/`downloadCsv`; `useSearchParamState`, `useListScope`; Base UI `Select` (with `items`).
- The settings-singleton pattern (`VendorSettings`, `NurtureSettings`, `CanvassingSettings`), the seed-by-key pattern (`prisma/seed-*.ts`), Postgres sequences for numbering (`src/lib/violations/case-number.ts`).
- The alert engine shape in `src/lib/vendors/alerts.ts` + `alert-run.ts` (copied, not imported).
- `weekRange` / `monthRange` in `src/lib/time/zone.ts`; `previousWorkingDay` in `src/lib/crews/install.ts` (generalised to `addWorkingDays`).

**Extended**
- `Lead`: `kind`, `organizationId`, `contactId`; `LEAD_LABEL_SELECT` and `customerName()` (prefer `companyName` for `GC_BID`).
- `Task`: `organizationId`; `TASK_LIST_INCLUDE`; `SubjectKind "organization"`; the entity chip icon.
- `createJobFromLead(leadId, userId, opts?)`.
- `src/app/api/leads/[id]/stage/route.ts`: refuse manual stage moves on `GC_BID` leads.
- Six customer-only surfaces gain a `kind: "CUSTOMER"` guard (§5, "the fence").
- `FileCategory` is **not** extended (vault documents own their storage, §10).
- `CalendarKind`, attention rows, search (`SearchHit.type`), sidebar `navSections`, ⌘K groups.
- `User`: `canViewRestrictedDocuments` grant (ruling 2).
- Intake service: a sender-based dispatcher for ITB mail (Phase 2).

---

## 4. Current gaps

1. No external-company or person-at-company record on the customer side.
2. No organisation-scoped interaction log (`Communication` and `ActivityLog` require a lead and are message/event shaped).
3. No prequalification or requirement-checklist concept; `VendorDocumentType` is a six-value enum about *their* documents.
4. No document versioning, effective/expiry dates, confidentiality or "approved for external distribution" on `File`; no package assembly.
5. No bid concept: no due dates, decisions, submissions, outcomes or loss reasons anywhere.
6. No market/territory taxonomy (`Lead.county` is free text; `Crew.counties[]`).
7. Trade taxonomy is split (ServiceCategory table; workflow keys; `EstimateTemplateCategory`; `TakeoffTrade`) and lacks Plumbing, Demolition and General Construction categories.
8. No estimator/office time tracking.
9. Date-range reporting has no presets (week/month/quarter/year).
10. Six surfaces would silently treat a GC bid lead as a homeowner (§5).
11. `createJobFromLead` hard-codes residential defaults (50% deposit, no billing method).
12. No general inbound-email association; the intake mailbox parses one lead-mail format.

---

## 5. Proposed GC Partnership architecture

### 5.1 Principle: extend the Lead, add the Organization

The spine of the CRM is `Lead → Job`, and every estimating and document tool
hangs off the Lead. The module keeps that spine: **a bid package is a Lead of
kind `GC_BID`**, so nothing downstream is rebuilt, and **the GC itself is a new
`Organization`** because nothing customer-side can represent a company with
many contacts. "Does CareyOS already have an entity for this?" is answered per
entity in §43-style form in §21 (Data model) and §34 (Not recommended).

### 5.2 Module layout

```
src/lib/partners/
  access.ts            explicit role lists + partnerPermissions()
  stages.ts            PARTNER_STAGES const (enum order, labels, tones)
  derive.ts            pure: badges (prequalified, bidding, quiet…), org state
  service.ts           Organization CRUD, stage change, owner change (audited)
  contacts.ts          Contact CRUD
  interactions.ts      write + lastContactAt + ActivityLog bridge + settle
  follow-ups.ts        pure planner (rules → tasks to raise / keys that live)
  follow-up-run.ts     raise/settle (copy of vendors/alert-run.ts)
  qualifications.ts    Qualification + requirements
  qualification-state.ts pure: derived EXPIRED / RENEWAL_DUE, coverage
  documents.ts         vault service (storage + encryption + audit)
  document-alerts.ts   pure expiry planner;  document-alert-run.ts
  bids.ts              invitation lifecycle (lead + invitation in one tx), award
  bid-state.ts         pure transition table
  bid-score.ts         pure bid/no-bid score (versioned weights)
  submissions.ts       append-only versions
  health.ts            pure relationship health
  scorecard.ts         pure KPI aggregation;  scorecard-load.ts
  windows.ts           pure week/month/quarter/year → {from,to}
  query.ts             list where-builders (reused by ⌘K)
  validation.ts        zod schemas + partnerErrorResponse
  settings.ts          PartnerSettings read/write + defaults
src/app/api/partners/**, src/app/api/bids/**, src/app/api/company-documents/**
src/app/api/cron/partner-follow-ups, src/app/api/cron/company-document-alerts
src/app/(dashboard)/partners/{page,[id],contacts,qualifications,vault,bids,analytics}
src/components/partners/*
prisma/seed-partners.ts, scripts/backfill-partners-coastal-choice.ts
docs/project-memory/features/partners.md
```

### 5.3 The fence: `Lead.kind`

A `GC_BID` lead must never be treated as a homeowner. Verified leak points and
the one-line guard each gets (`kind: "CUSTOMER"` unless a caller asks for bids):

| Surface | Code | Why it matters |
|---|---|---|
| Leads list + board | `src/lib/leads/query.ts` `buildLeadListWhere` | Bids would mix with homeowners; default to CUSTOMER, `kind=` param to show bids. |
| Nurture enrolment | `src/lib/nurture/run.ts` (enrol `where`) | The estimator would receive "checking in on your project" mail from day 2 once nurture is on. |
| Follow-up rules | `src/lib/follow-ups/events.ts` `emitLeadEvent` | A stage move on a bid lead would fire template SMS/email. |
| Overdue follow-ups row | `src/lib/attention/load.ts` `overdueFollowUpsWhere` | Bid follow-ups have their own rows. |
| Dashboard KPIs + funnel | `src/lib/reports/dashboard-scope.ts`, `src/app/api/reports/route.ts` (overdue count and funnel cohort) | Close rate and funnel are residential-stage-named. |
| ⌘K / search | `src/lib/search/format.ts` | Shown, but labelled "Bid BID-00012 · Coastal Choice". |

Why a column and not `bidInvitation != null` or a source channel: a column is
indexable, survives a deleted invitation, and does not depend on an
admin-editable source name (the same bug class as the 12 stage-name
dependencies the repo already carries). A vitest asserts `buildLeadListWhere({})`
carries the guard.

### 5.4 Flow

```
Organization (GC) ── Contacts ── Interactions ── follow-up tasks
      │
      ├── Qualification ── Requirements ── CompanyDocument (vault)
      │
      └── Lead(kind=GC_BID) + BidInvitation ── BidSubmission (v1, v2…)
              │  (estimates, takeoff, files, tasks, comms as today)
              └── Won → createJobFromLead(PROGRESS, 10% retainage, no deposit)
                      └── Job → invoices/payments/costs → scorecard → health
```

---

## 6. Proposed user experience

**Navigation.** A new collapsible sidebar section (same `NavSection` shape as
Code Violations):

```
BUSINESS DEVELOPMENT
  GC Partnerships   /partners            (table | board)
  Contacts          /partners/contacts
  Qualifications    /partners/qualifications          (Stage 2)
  Bids              /partners/bids       (list | board) (Stage 3)
  Bid Calendar      /calendar?kinds=bid_date           (Stage 3)
  Document Vault    /partners/vault                    (Stage 2)
  Analytics         /partners/analytics                (Stage 4)
```

Admin → Business Development Settings (`/admin/partners`): follow-up
thresholds, default owner, vault owner, markets, requirement set, score weights.

**GC account page** `/partners/[id]` — `EntityHeader` with the stage stepper,
owner, priority, derived badges, health score (Stage 4); tabs in the URL
(`?tab=`): Overview · Contacts · Qualification · Bids · Projects · Activity ·
Documents · Performance. Overview carries the next open task, last touch, the
"Log interaction" button and the GC profile card.

**Bid detail lives on the Lead page** as a "Bid" tab shown first for
`GC_BID` leads (with a header banner naming the GC and the due date). The lead
page already drives ten tabs from `?tab=` and hosts the estimate builders,
takeoff, files and comms; a dedicated `/bids/[id]` page would re-embed six
panels. `/partners/bids` rows link to `/leads/[id]?tab=bid`.

**Logging an interaction** is one screen that works at 400 px: contact
(optional), type, direction, outcome (required radio), date (defaults now),
summary, "create follow-up task" (date + title prefilled). This is the daily
input; everything else derives from it.

**Lists** use `ListToolbar` with Mine/All (owner = me), text search, stage /
owner / market / trade filters mirrored to the URL, CSV export. The board uses
the kanban kit with `PARTNER_STAGES` as `StageLike[]` columns and
`useOptimisticMove` → `PATCH /api/partners/[id]/stage`.

---

## 7. Relationship pipeline

**Recommendation: a Prisma enum with six hand-moved stages, everything else a
derived badge.** Richard's 18 stages mix hand-moved states with facts the CRM
can read (prequalified, first bid received, first award, preferred). The
`LeadStage` table precedent brought 12 string dependencies on stage names
(`"New Lead"`, `"Won"`, `"Estimate Sent"` in `funnel.ts`); the partner engine
needs stage semantics (follow-up thresholds per stage), so an editable table
would reproduce that coupling.

| `PartnerStage` | Meaning | Rules that key on it |
|---|---|---|
| `TARGET` | Identified; no two-way contact yet | rule 1 (first contact) |
| `CONTACTED` | Two-way contact made | rule 2 (no response) |
| `ENGAGED` | Meeting held, relationship live | rules 2, 3, 4 |
| `ACTIVE` | Bidding or awarded | rule 5 (quiet partner) |
| `DORMANT` | Deliberately parked | none |
| `DO_NOT_PURSUE` | Terminal | none |

Derived badges (pure `derive.ts`, computed on read): Prequal pending ·
Prequalified · Prequal expiring (≤60 d) · First bid received · Bidding (open
bids) · Awarded · Repeat (≥2 jobs) · Preferred (configurable threshold:
≥2 awards and margin ≥ X) · Quiet N days. `PartnerStageHistory` keeps
from/to/reason/user; stage changes are audited.

Fallback if Richard wants editable stages: a `PartnerStage` table with a
`semantic` enum column the engine keys on — never names.

---

## 8. Contact management

`Contact` is a person at an Organization. Fields: `firstName, lastName, title,
roleTag ContactRole {ESTIMATOR, SENIOR_ESTIMATOR, PRECON_MANAGER, PRECON_DIRECTOR,
PROCUREMENT, TRADE_PARTNER_MANAGER, BUSINESS_DEVELOPMENT, PROJECT_EXECUTIVE,
PROJECT_MANAGER, SUPERINTENDENT, ACCOUNTS_PAYABLE, SAFETY, OTHER}, email, phone,
mobile, linkedinUrl, office, geography, trades String[], relationshipStrength
Int? (1–5, CHECK), influence Int? (1–5, CHECK), lastContactAt (derived from
interactions, stored for indexing), notes, isPrimary (partial unique index: one
per org), isActive`.

Why not reuse Lead: a Lead is a person *and a property* with required address
and phone, and it enrols in nurture. Why not Vendor's inline contact: one
string, no table.

`/partners/contacts` lists people across GCs with filters company / role /
geography / trade / owner / last contact. ⌘K gains a Contacts group.
`GET /api/leads/contact-lookup` (used by phone routing) also searches
`contact.phone/mobile/email` so a calling estimator resolves to their company.

---

## 9. Prequalification system

One `Qualification` per org per platform or renewal cycle:

```
Qualification { organizationId, platform, portalUrl, ownerUserId,
  status QualificationStatus {NOT_STARTED, IN_PROGRESS, SUBMITTED,
    INFO_REQUESTED, APPROVED, REJECTED},        // hand-moved
  submittedAt, approvedAt, expiresAt, renewalDueAt, notes }
```

`EXPIRED` and `RENEWAL_DUE` are **derived** from `expiresAt`/`renewalDueAt`
versus today in pure `qualification-state.ts` (the vendors rule: derived on
read, never stored). Richard's RESEARCHING / STARTED / DOCUMENTS_REQUIRED
collapse into IN_PROGRESS — the requirement rows say what is missing.

**Checklist.** `QualificationRequirement { qualificationId, documentTypeId →
CompanyDocumentType, required, status {PENDING, ACCEPTED, REJECTED, WAIVED},
companyDocumentId?, providedAt, notes }`. "Missing" vs "provided" derives from
`companyDocumentId`; "provided but expired" derives from the document.
`CompanyDocumentType` is a seeded, admin-editable table (`key, name, category,
defaultValidityMonths, isActive`): W-9, GL COI, WC COI (or exemption), Auto
COI, Umbrella COI, Contractor licence, Trade licences, Safety program, OSHA
300/300A, EMR letter, Financial statements, Banking letter, Bonding letter,
References, Project history, Capabilities statement. A qualification is created
with the default requirement set from `PartnerSettings.defaultRequirementTypeIds`
and edited per GC — nothing is hard-coded globally.

Status changes and requirement decisions are audited; SUBMITTED starts rule 3.

---

## 10. Qualification document vault

`CompanyDocument` holds KNU's own documents with their own storage columns
(the `VendorDocument` / `PersonnelDocument` pattern), **not** a `File` row:

```
CompanyDocument { documentTypeId, title, version Int (CHECK ≥1),
  effectiveDate, expiresAt, confidentiality {INTERNAL, RESTRICTED, SHAREABLE},
  approvedForExternal Boolean, supersedesId?, notes,
  fileName, fileType, fileSize, storageKey, encryptedKeyVersion?,
  uploadedByUserId, createdAt }   @@unique([documentTypeId, version])
```

Why own storage: RESTRICTED bytes are encrypted at rest with the existing
keyring (`encryptWithKeyring`, AAD `company-document:<id>`), served by one
audited route (`GET /api/company-documents/[id]/file`), and the generic file
routes and `fileReadWhere` stay untouched. `fileExists` still powers the
missing-on-disk state. "Current" = highest version per type, derived.
Uploading a new version shows **"Used by N active qualifications"** (requirement
rows pointing at the superseded version) with a one-click "mark as sent" per
GC once the new file goes out.

Package assembly ("send the Moss package"): Phase 3 — select the GC's
requirement rows, zip the current SHAREABLE/`approvedForExternal` documents,
log an `Interaction` of kind `DOC_SENT`. No zip library is in the repo today;
`fflate` is the smallest candidate.

---

## 11. Opportunity management

No `Opportunity` entity. A GC project KNU hears about before an invitation is a
`BidInvitation` at status `TRACKING` on a `GC_BID` lead; when the invitation
arrives it becomes `INVITED`. A multi-trade project (roofing package + plumbing
package) is two sibling bid leads sharing `projectName` and address — one job
per lead matches reality (JOB-00009 is one package) and keeps the estimators
and `createJobFromLead` unchanged. `projectName` groups them visually on the GC
page; a `BidProject` table is deferred until the pattern proves common.

Creating a bid lead writes the required Lead columns from the GC: `firstName/
lastName` = primary contact, `primaryPhone` = contact phone, else org phone,
else `"N/A"` (the Clewiston lead literally carries `"TBD"`), `companyName` =
org name, `propertyAddress1/city/zipCode` = the project site,
`propertyType COMMERCIAL`, `sourceId` = seeded "GC bid invitation",
`services` = the package trade, `estimatedJobValue` = estimated contract value,
`assignedUserId` = the estimator (so `fileReadWhere` lets a SALES_REP estimator
open the ITB files), `kind GC_BID`, `organizationId`, `contactId`. Written by
the service through Prisma, not through `createLeadSchema`.

---

## 12. Bid invitation management

```
BidInvitation { leadId @unique, organizationId, contactId?, number "BID-00001"
  (sequence), projectName, projectType, scopeSummary,
  invitedAt, bidDueAt, siteWalkAt, preBidMeetingAt, rfiDueAt, addendaDeadlineAt,
  interviewAt, expectedAwardAt, addendaCount, specsReceived,
  estimatorUserId, siteVisitRequired, bondRequired, prevailingWage, unionRequired,
  insuranceNotes, scheduleNotes, platform BidPlatform {BUILDINGCONNECTED, PROCORE,
  PLANHUB, SMARTBID, CONSTRUCTCONNECT, TEXTURA, EMAIL, OTHER}, platformUrl, platformRef,
  status BidStatus {TRACKING, INVITED, DECIDING, ESTIMATING, SUBMITTED, SHORTLISTED, CLOSED},
  waitingOn String?,                  // "supplier quote", "sub pricing" — text, not states
  decision BidDecision {UNDECIDED, BID, NO_BID}, decisionScore Int? (CHECK 0–100),
  decisionFactors Json? (weights version + inputs + breakdown), decisionReason,
  decidedByUserId, decidedAt, submittedAt, estimatingHours Decimal?,
  outcome BidOutcome? {AWARDED, LOST, NO_BID, CANCELLED, NO_DECISION, REBID},
  lossReason? {PRICE, RELATIONSHIP, SCHEDULE, SCOPE, QUALIFICATION, BONDING,
  CAPACITY, COMPETITOR, UNKNOWN, OTHER}, winningContractor, winningPrice,
  outcomeNotes, outcomeAt, awardedAmount, contractReceivedAt }
CHECK (outcome IS NULL OR status = 'CLOSED'); CHECK (awarded_amount IS NULL OR outcome = 'AWARDED')
```

Richard's 14 statuses split into pipeline columns (`status`), a `waitingOn`
note, and the terminal `outcome`. `plansReceived` derives from the lead's plan
sets; "our price" derives from the latest submission. Dates feed the calendar
(§23) and the attention rows "Bids due this week" and "Bids awaiting decision".
Bid status is the master; the lead's stage mirrors only Won/Lost (§15), and the
lead stage route refuses manual moves on `GC_BID` leads so the Leads board and
the bid cannot desync.

**Bid/No-Bid score** (pure `bid-score.ts`, 0–100, advisory, versioned weights
in `PartnerSettings`):

| Factor | Mode | Derivation | Max |
|---|---|---|---|
| Relationship | AUTO | health score × 0.15 | 15 |
| Size vs typical | AUTO | `estimatedJobValue` vs the trade's typical range | 10 |
| Trade fit | AUTO, gate | package trades ⊆ KNU trades; none → forced NO_BID | 10 |
| Market | AUTO | `lead.county` in home / adjacent markets | 10 |
| Lead time | AUTO | days to `bidDueAt` | 5 |
| GC payment history | AUTO | avg days-to-pay; null = neutral + concern | 10 |
| Win rate with GC | AUTO | needs ≥3 decided submissions, else neutral | 5 |
| Insurance current | AUTO (Stage 2) | required vault docs in force; lapsed → −5 + concern | 0/−5 |
| Bonding | gate | `bondRequired` and no bonding capacity set → cap at REVIEW | — |
| Expected margin | MANUAL 1–5, prefilled from the linked estimate | ×2 | 10 |
| Capacity (workforce + estimator) | MANUAL 1–5 | ×2 | 10 |
| Competition | MANUAL 1–5 | ×1 | 5 |
| Complexity / risk | MANUAL 1–5 | ×1 | 5 |
| Plans quality + contract terms | MANUAL 1–5 | ×1 | 5 |

Bands ≥70 BID · 50–69 REVIEW · <50 NO_BID; gates only move downward. Output
`{score, recommendation, reasons[3], concerns[], breakdown, inputsSnapshot}`
stored in `decisionFactors` with the weights version, so a later weight edit
never rewrites history. The human records `decision`; the score is advice.

---

## 13. Estimate integration

Nothing new. The bid lead's "Bid" tab sits beside the existing Estimates tab
(both families), the Plan takeoff tab and Files. `BidSubmission` links an
`estimateId` or `roofEstimateId` (CHECK at most one) and snapshots
`totalPrice` and `subtotalCost`, so expected margin at submission is recorded
even if the estimate is later edited. A SUBMITTED status does not move the lead
to "Estimate Sent" by name (see §7's reasoning); the estimate's own SENT status
and follow-up task behave as today.

---

## 14. Bid outcome tracking

`BidSubmission { bidInvitationId, version Int, kind {ORIGINAL, REVISED, ALTERNATE,
VALUE_ENGINEERING}, amount, estimateId?, roofEstimateId?, snapshotTotalPrice,
snapshotSubtotalCost, submittedAt, method {PLATFORM, EMAIL, PORTAL, HAND, OTHER},
recipientContactId?, alternates, clarifications, exclusions, fileId? (a File on
the lead, category ESTIMATE), submittedByUserId } @@unique([bidInvitationId, version])`
— append-only; a revision is a new row.

Outcome capture on close: `outcome`, `lossReason`, `winningContractor`,
`winningPrice` (price gap = latest amount − winning price), `outcomeNotes`,
`outcomeAt`; `awardedAmount` on AWARDED. Every outcome is audited
(`bid_outcome`). Loss reasons and price gaps feed §16 and the bid score's
win-rate factor.

---

## 15. Award → project workflow

AWARDED does three things in one service call (`bids.ts awardBid`):
1. Closes the invitation (`status CLOSED, outcome AWARDED, awardedAmount`).
2. Sets `lead.estimatedJobValue = awardedAmount` and moves the lead to the
   `isWon` stage through the same history/activity/audit writes the stage route
   makes.
3. Calls `createJobFromLead(leadId, userId, { billingMethod: "PROGRESS",
   retainagePercent: 10, depositRequired: 0, title: "<trade> — <projectName>",
   skipDepositTask: true })`. The options argument is the change: today the
   function hard-codes a 50% deposit and the "Collect deposit" task and never
   sets `billingMethod`; patching the job afterwards would leave both behind.
   Inside, `lead.kind === "GC_BID"` picks these defaults when no options are
   given. The residential workflow auto-apply still runs on the service names
   (Core + the trade), which is right for a sub package.

Carried forward without copying: GC and contact (`job.lead.organizationId`),
project address (the lead), estimate (on the lead), scope (lead services),
contract amount, trade, documents (lead files show on the job's Files tab in
their own group), schedule (`targetStartDate` set from `expectedAwardAt` or by
hand). LOST moves the lead to the `isLost` stage. Reopening a CLOSED invitation
moves the lead back to the first open stage by `stageOrder`.

---

## 16. GC performance analytics

Pure `scorecard.ts` over the module's tables plus `getJobCostRows({ lead:
{ organizationId } })` and invoices/payments; windows from `windows.ts`.

| KPI | Derivation | Anchor |
|---|---|---|
| Invitations | count `BidInvitation` with `invitedAt` in window | invitedAt |
| Bid rate | decision BID ÷ decided | decidedAt |
| Submitted | `submittedAt` in window | submittedAt |
| Win rate (outcome) | AWARDED ÷ (AWARDED + LOST) | outcomeAt |
| Win rate (cohort) | AWARDED among submitted-in-window ÷ submitted, pending shown | submittedAt |
| Win rate by value | Σ latest amount AWARDED ÷ Σ decided | outcomeAt |
| Open bid value | Σ latest submission amount, else `estimatedJobValue`, over open invitations | — |
| Awarded revenue | Σ `Job.contractAmount` of awarded invitations' jobs | outcomeAt |
| Gross profit / margin | Σ `projectedProfit` / Σ `revisedContract` from `getJobCostRows` | job |
| Average contract | mean `awardedAmount` | outcomeAt |
| Bid turnaround | mean `submittedAt − invitedAt` | submittedAt |
| Days to pay | mean `Payment.receivedDate − Invoice.issueDate` where `invoiceId` set and RECEIVED; "n unlinked payments excluded" | receivedDate |
| Retainage held | from `getBillingSummary` on PROGRESS jobs | — |
| Change-order approval rate | APPROVED ÷ (APPROVED + REJECTED) `ChangeOrder` on the org's jobs | decidedAt |
| Estimating hours / GP per hour | Σ `estimatingHours` of BID decisions in window; Σ projected profit of awards ÷ that | decidedAt |
| Loss reasons, price gap | counts by `lossReason`; median `(amount − winningPrice)/winningPrice` | outcomeAt |
| Repeat work | jobs per org ≥ 2 | — |
| Relationship activity | interactions / meetings in window | occurredAt |

Not derivable yet and the field that fixes it: estimator time
(`estimatingHours`, manual); response received (`Interaction.direction` +
`outcome`); GC paper received (`contractReceivedAt`); retainage release date per
invoice (defer). Days-to-pay is only as good as entered `receivedDate`s and
`invoiceId` links — JOB-00009's imported payments carry real dates, so the one
data point today is clean; the invoice/payment UI should default the link when a
payment is recorded against an application.

Reports (§35) are the same aggregation grouped by org, trade, market, owner,
with CSV export through `toCsv`.

---

## 17. Relationship scoring

Pure `health.ts`, 0–100, computed on read, weights in `PartnerSettings`
(zod-validated JSON with defaults, like `scoring-config.ts`):

| Section | Max | Rule (defaults, editable) |
|---|---|---|
| Engagement | 30 | recency ≤14 d 15 · ≤30 12 · ≤60 8 · ≤90 4 · else 0; meetings/365 d 0/5/8; interactions/90 d 0/2/4/7 |
| Qualification | 20 | APPROVED >90 d to expiry 20 · ≤90 d 14 · SUBMITTED 10 · IN_PROGRESS 5 · expired 2 · none/rejected 0 |
| Bid flow | 25 | invitations/365 d 0/6/10/14; submit ratio ≥0.5 +4; awards/365 d 0/5/7 |
| Economics | 25 | revenue/365 d ≥500k 10 · ≥100k 7 · ≥25k 4 · >0 2; margin ≥25% 8 · ≥15% 5 · ≥5% 2; days-to-pay ≤30 7 · ≤45 5 · ≤60 2 |

Dormant cap: no interaction in `dormantAfterDays` (180) caps the total at
`dormantCap` (40) — old revenue cannot keep a dead relationship reading healthy.
Bands ≥80 Strong · 60–79 Active · 40–59 Developing · 20–39 Cold · <20 Dormant.
Output `{score, band, breakdown, strengths[], weaknesses[], recommendedAction}`;
strengths/weaknesses are rule-generated (section ≥70% of max / ≤30%), the
action is the first match in an ordered table (expired prequal → "Restart
prequalification"; expiring ≤60 d → "Renew before {date}"; quiet >60 d → "Call
{primary contact}"; invitations but no submissions → "Bid the next one or record
why we pass"; slow payer → "Raise terms before the next bid"; else "Keep
cadence — next touch by {date}").

Worked example (Coastal Choice, plausible values): last touch 20 d, 3
interactions/90 d, 1 meeting, APPROVED with 200 d left, 1 invitation, 1
submission, 1 award, $300k revenue, 25% margin, 45 days to pay → 21 + 20 + 15 +
20 = **76, Active**; weakness "one invitation in 12 months". The same org
untouched for 200 d → capped at 40, "Call {contact}".

AI may later turn `breakdown` into two sentences. It may not add a point, pick a
band, or assert anything absent from the breakdown JSON.

---

## 18. Payment intelligence

Data already exists: `Invoice{issueDate, dueDate, paidAt, applicationNumber}`,
`Payment{receivedDate, invoiceId, status}`, `getArAging`. Per GC: average days
to pay, contract terms (a `paymentTermsDays` column on Organization, manual),
historical delay = average − terms, retainage held (`getBillingSummary`),
final-payment lag. Shown on the GC Performance tab and used by the bid score.
Two hygiene items make it reliable: record payments against their application
(`invoiceId`), and enter the real received date (the dialog defaults to today
but must stay editable).

---

## 19. AI opportunities

Post-Stage-4. The uncommitted takeoff `runAiCall` (cached by input hash,
cost-capped, zod-typed output, calls logged) is the pattern, generalised from
`takeoffId` to a generic subject so a `PartnerAiCall` ledger can share it.

| Use | Allowed | Not allowed |
|---|---|---|
| Explain a health or bid score | Two sentences from the breakdown JSON | Changing the number |
| Draft a follow-up email or ITB acknowledgement from the interaction history | For the user to edit and send | Sending |
| Propose invitation fields from a forwarded ITB (§20, Phase 2) | Prefill for confirmation | Creating the invitation |
| Answer "which GC should we follow up with today?" | Over the deterministic scorecard rows | Inventing a metric |
| Flag contract provisions (§32 of the brief) | List clauses found with page refs for human review | Legal conclusions |

---

## 20. Future opportunity discovery

Phase 5. Sources are permits (the CRM already has `PermitLookupRun` and the
Zylow property client as precedents for external lookups), planning agendas,
public bids, GC and developer sites. The flow — project detected → identify GC
→ match `Organization` → identify trade → create a `BidInvitation` at `TRACKING`
flagged `needsReview` with the source URL — reuses Stage 3 tables and adds only
a `signalSource` column and a review queue. Nothing in the existing architecture
makes it free, so it stays out of the MVP.

---

## 21. Data model / ERD

```
User ──owner──► Organization ◄──org── Contact
                 │ kind, stage, priority, markets[], profile cols, vendorId?
                 ├── OrganizationTrade ──► ServiceCategory
                 ├── PartnerStageHistory
                 ├── Interaction (contactId?, leadId?, userId)
                 ├── Qualification ── QualificationRequirement ──► CompanyDocumentType
                 │                           └──────────────────► CompanyDocument (vault)
                 ├── Task.organizationId (follow-ups, next actions)
                 └── Lead(kind=GC_BID, organizationId, contactId)
                        ├── BidInvitation (1:1) ── BidSubmission (versions) ──► Estimate | RoofEstimate
                        ├── Estimate, RoofEstimate, PlanSet/Takeoff, File, Communication, Task   (as today)
                        └── Job (on Won) ── Invoice/Payment/JobExpense/LaborContract (as today)
PartnerSettings (singleton): thresholds, owners, markets, requirement set, weights(+version)
```

Per entity, "does CareyOS already have this?":

| Need | Existing? | Decision |
|---|---|---|
| GC company | No (Lead = person+property; Vendor = payee) | New `Organization`, optional `vendorId` link for a GC that is also a payee |
| GC contact | No | New `Contact` |
| Interaction | `Communication`/`ActivityLog` require a lead and are message/event shaped; 35 + 54 call sites assume it | New `Interaction`, bridged into the bid lead's ActivityLog when `leadId` is set |
| Pipeline stage | `LeadStage` table (name-coupled) | Enum `PartnerStage` + history |
| Opportunity / bid | No | `Lead.kind GC_BID` + 1:1 `BidInvitation` |
| Bid versions | `GeneratedDocument.versionNumber` is job-bound | New `BidSubmission` |
| Prequal | No | New `Qualification` + requirements |
| Document types | `VendorDocumentType` enum (6 values, their docs) | New `CompanyDocumentType` table |
| Our documents | `File` (no version/expiry/confidentiality) | New `CompanyDocument` with own storage |
| Markets | `Lead.county` free text | `Organization.markets String[]`, list in settings |
| Trades | `ServiceCategory` | Reuse; seed Plumbing, Demolition, General Construction |
| Next action | `Task` | Reuse via `Task.organizationId` |
| Settings | singleton pattern | New `PartnerSettings` |

Schema sketch (abridged):

```prisma
enum LeadKind { CUSTOMER GC_BID }
enum OrganizationKind { GENERAL_CONTRACTOR DEVELOPER PROPERTY_MANAGER ARCHITECT ENGINEER MUNICIPALITY REFERRAL_PARTNER OTHER }
enum OrganizationPriority { A B C }
enum PartnerStage { TARGET CONTACTED ENGAGED ACTIVE DORMANT DO_NOT_PURSUE }
model Organization {
  id, name, nameKey @unique, kind, website?, phone?, email?, address1?, address2?, city?, state?, zipCode?,
  localOffices?, markets String[], notes?, isActive,
  ownerUserId?, priority?, stage @default(TARGET), lastContactAt?, nextFollowUpAt?, potentialAnnualRevenue?,
  paymentTermsDays?, annualVolume?, companySize?, projectTypes String[], typicalProjectSize?,
  biddingPlatform?, prequalPlatform?, vendorRegistrationUrl?, requirementsNotes?, vendorId?,
  createdByUserId, createdAt, updatedAt
  // relations: trades, contacts, interactions, stageHistory, qualifications, leads, tasks, bidInvitations
}
model Contact { … organizationId, roleTag ContactRole, relationshipStrength Int?, influence Int?, isPrimary … }
model Interaction { organizationId, contactId?, leadId?, userId, kind InteractionKind, direction, outcome InteractionOutcome?,
  occurredAt, summary, createdAt }
model PartnerStageHistory { organizationId, fromStage?, toStage, reason?, changedByUserId, changedAt }
model CompanyDocumentType { key @unique, name, category, defaultValidityMonths?, isActive, sortOrder }
model CompanyDocument { … @@unique([documentTypeId, version]) }
model Qualification { … } ; model QualificationRequirement { … }
model BidInvitation { leadId @unique, organizationId, number @unique, … }
model BidSubmission { … @@unique([bidInvitationId, version]) }
model PartnerSettings { id @default("default"), newTargetDays 5, noResponseDays 7, qualSubmittedDays 14,
  prequalNoBidDays 30, activeQuietDays 60, dormantAfterDays 180, defaultOwnerUserId?, vaultOwnerUserId?,
  markets String[], defaultRequirementTypeIds String[], scoreWeights Json, scoreWeightsVersion Int }
// Lead: kind LeadKind @default(CUSTOMER) @@index, organizationId?, contactId?
// Task: organizationId?
// User: canViewRestrictedDocuments Boolean @default(false)
```

Hand-appended SQL: `CREATE SEQUENCE bid_invitation_number_seq`; CHECKs on
relationship/influence 1–5, decision score 0–100, document version ≥ 1, the two
bid CHECKs, the one-source CHECK on submissions; partial unique index
`contacts(organization_id) WHERE is_primary`.

---

## 22. API changes

All routes: `getSession` → predicate from `partners/access.ts` → `validateBody`
→ service → `partnerErrorResponse`; list GETs return `{ rows, canManage }`.

| Route | Methods | Stage |
|---|---|---|
| `/api/partners` | GET list (search, stage, owner, market, trade, scope) · POST | 1 |
| `/api/partners/[id]` | GET detail · PATCH · DELETE (ADMIN/MANAGER, no bids/jobs) | 1 |
| `/api/partners/[id]/stage` · `/owner` | POST (audited) | 1 |
| `/api/partners/[id]/contacts`, `/api/partners/contacts`, `/api/contacts/[id]` | GET/POST/PATCH | 1 |
| `/api/partners/[id]/interactions`, `/api/interactions/[id]` | GET/POST/PATCH/DELETE | 1 |
| `/api/partners/settings` | GET/PUT (ADMIN/MANAGER) | 1 |
| `/api/cron/partner-follow-ups` | POST (`requireCronSecret`, `?dryRun=1`) | 1 |
| `/api/leads/contact-lookup` | + contact matches | 1 |
| `/api/search` | + organizations, contacts | 1 |
| `/api/partners/[id]/qualifications`, `/api/qualifications/[id]`, `…/requirements`, `…/requirements/[rid]` | CRUD + status | 2 |
| `/api/company-documents`, `/[id]`, `/[id]/file` (audited, no-store, rate-limited), `/types` | CRUD | 2 |
| `/api/cron/company-document-alerts` | POST | 2 |
| `/api/bids` | GET list/board · POST (creates lead + invitation) | 3 |
| `/api/bids/[id]` · `/status` · `/decision` (+ `?preview=1` score) · `/outcome` · `/award` · `/submissions` | | 3 |
| `/api/leads/[id]` | include `bidInvitation`, `organization` | 3 |
| `/api/leads/[id]/stage` | 409 on `GC_BID` ("change the bid status instead") | 3 |
| `/api/calendar` | `bid_date` overlays (lead-scoped) | 3 |
| `/api/attention` rows | `partner-follow-ups`, `qualifications-expiring`, `company-docs-expiring`, `bids-due`, `bids-awaiting-decision` | 2–3 |
| `/api/partners/[id]/scorecard`, `/api/partners/analytics?preset=&from=&to=&groupBy=` | GET | 4 |

---

## 23. Frontend changes

- Sidebar section + ⌘K groups (Stage 1); icons from lucide.
- `/partners` (table | board), `/partners/[id]` tabs, `/partners/contacts`;
  components `org-form-dialog`, `contact-form-dialog`, `interaction-dialog`,
  `partner-board`, `partner-card`, `stage-badges`, `use-partners.ts`.
- `/partners/qualifications`, `/partners/vault`, Qualification + Documents tabs;
  `qualification-card`, `requirement-row`, `vault-upload-dialog`,
  `document-version-list`, confidentiality badge.
- `/partners/bids` (list | board by `BidStatus`), the Lead page "Bid" tab
  (`src/components/partners/bid-panel.tsx`: header facts, dates, decision
  dialog with sliders and the live score, submissions list + dialog, outcome
  dialog, award button), bid banner on the lead header.
- Calendar: `bid_date` overlay icon; `?kinds=bid_date` filter for "Bid Calendar".
- Dashboard: the attention rows appear automatically; `/partners/analytics`
  with preset buttons (week/month/quarter/year/custom) → `dateFrom/dateTo`,
  `KpiCard`s, recharts bars by GC / trade / market, CSV.
- Admin: `/admin/partners` settings page (thresholds, owners, markets,
  requirement set, score weights with version bump), copied from
  `/admin/canvassing-settings`.
- Phone: all pages QA'd at 400 px; the interaction dialog is the one form that
  must be one-thumb.

---

## 24. Background jobs

| Cron | Does | Schedule |
|---|---|---|
| `partner-follow-ups` | Runs the five rules (§26 of the brief; §25 here) for every active org; raises once per key; settles handled on write | `55 11 * * 1-5` (after vendor-compliance) |
| `company-document-alerts` | Expiring (30 d, HIGH, due 14 d before) and expired (URGENT) tasks per current vault document; qualification expiry/renewal tasks | `56 11 * * 1-5` |
| (Phase 2) intake dispatcher | ITB mail → `BidInvitation` needing review | existing intake cadence |

Both are idempotent per day and answer `{"raised":n,"settled":m}`; wrappers
`crm-cron/partner-follow-ups.sh` and `company-document-alerts.sh` on the
`knuco` crontab, installed after the deploy like the vendor one.

---

## 25. Notifications

No new notification kinds in Stages 1–3: every engine output is a task, and
`createTask` already notifies the assignee (`task.assigned`) and feeds the
digests. That avoids touching the `NotificationCategory` enum and
`NotifySubjectType`. Candidates for Stage 4+: `bid.outcome` (to the org owner
and estimator), `qualification.status` — added to `kinds.ts` with category
`JOB_ACTIVITY` or a new `BUSINESS_DEVELOPMENT` category (enum migration).

Follow-up rule definitions (pure `follow-ups.ts`; key prefix
`org:<id>:followup:`; one open task per org per rule; `#period =
floor(days/threshold)` so a still-true condition re-raises once per period
after the previous task closed; assignee = org owner → settings default →
oldest admin):

| # | Trigger | Measure | Default | Task | Settles when |
|---|---|---|---|---|---|
| 1 | stage TARGET, no interactions | working days since created | 5 | "{org}: first contact overdue" | any interaction or stage change |
| 2 | last interaction OUTBOUND with outcome NO_ANSWER / LEFT_MESSAGE / SENT and no later INBOUND or SPOKE/MEETING | days since it | 7 | "{org}: no reply to your {type} on {date}" | a later interaction (re-keyed per interaction) |
| 3 | qualification SUBMITTED | days since submittedAt | 14 | "{org}: prequal submitted {date} — check status" | status leaves SUBMITTED |
| 4 | qualification APPROVED, stage ≥ ENGAGED | days since last invitation / bid interaction / approval | 30 | "{org}: prequalified, no bid activity in {n} days" | new invitation or BID_DISCUSSION interaction |
| 5 | stage ACTIVE | days since any interaction | 60 | "{org}: quiet for {n} days — schedule a check-in" | any interaction |

Rule 2 is the only one needing a "response received" fact; the required
`outcome` radio and `direction` on the log form capture it. Working-day math:
generalise `previousWorkingDay` (`src/lib/crews/install.ts`) into
`src/lib/time/working-days.ts addWorkingDays`. Rules never block anything and
never send mail to a GC.

---

## 26. Permissions

`src/lib/partners/access.ts`, explicit lists, plus `partnerPermissions(user)`
returned by the detail route (the `casePermissions` shape):

| Capability | ADMIN | MANAGER | OFFICE_STAFF | SALES_REP | MARKETING | READ_ONLY | CREW_LEAD |
|---|---|---|---|---|---|---|---|
| View orgs / contacts / interactions | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Create/edit org, contact, log interaction | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Change owner, DO_NOT_PURSUE, delete org | ✓ | ✓ | – | – | – | – | – |
| Create invitation, record outcome | ✓ | ✓ | ✓ | ✓ | – | – | – |
| Decide bid / no-bid, award | ✓ | ✓ | – | – | – | – | – |
| See bid amounts | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| See cost / margin on bids and the scorecard | ✓ | ✓ | ✓ | – | – | ✓ | – |
| Vault: list, download SHAREABLE | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| Vault: download INTERNAL | ✓ | ✓ | ✓ | ✓ | – | ✓ | – |
| Vault: upload, new version | ✓ | ✓ | ✓ | – | – | – | – |
| Vault: set approvedForExternal / confidentiality | ✓ | ✓ | – | – | – | – | – |
| Vault: download RESTRICTED | ✓ | grant | grant | – | – | – | – |
| Analytics | ✓ | ✓ | ✓ | – | – | ✓ | – |
| Settings | ✓ | ✓ | – | – | – | – | – |

Own-only scoping is **not** applied to partners at 7 users (Mine/All is a
convenience filter on owner); revisit at ~15 users. Two rulings for Richard:
whether SALES_REP manages partners (recommended yes: BD is sales work, unlike
vendors) and who reads RESTRICTED (recommended ADMIN always, MANAGER /
OFFICE_STAFF through a `canViewRestrictedDocuments` grant read fresh like
`getFieldGrants`).

---

## 27. Security

- **Nothing sensitive as fields.** No bank account or routing numbers, EIN,
  owner SSN/DOB, or GC portal passwords are stored as columns — a W-9 or bank
  letter is a RESTRICTED document; a portal gets URL + username hint only.
- **RESTRICTED at rest**: bytes encrypted with the keyring
  (`encryptWithKeyring`, AAD `company-document:<id>`, `encryptedKeyVersion` on
  the row); `scripts/rotate-field-encryption.ts` gets a sibling sweep for blobs.
  INTERNAL/SHAREABLE stay plain in `UPLOADS_DIR` as today.
- **One download route**, `Content-Disposition: attachment`, `Cache-Control:
  no-store`, rate-limited (`src/lib/rate-limit`), 404 outside the viewer's
  rights (never 403 on RESTRICTED, so existence is not probed).
- **Audit** `document_view` with IP and user agent on every RESTRICTED read
  (the `ssn_view` / personnel-document precedent), plus `confidentiality_change`
  and `approved_for_external` flips with before/after. The vendor document
  route has no view audit — do not copy that one.
- **Bid files** are `File` rows on the GC lead; `fileReadWhere` scopes own-only
  roles by lead involvement, so the invitation sets `assignedUserId` to the
  estimator/owner.
- **No outbound automation to GCs**: the module never emails a contact; the
  nurture and follow-up-rule engines are fenced by `Lead.kind`.
- Cron routes behind `CRON_SECRET`; settings writes ADMIN/MANAGER only; every
  write audited.
- Not stored at all: competitor bid tabs obtained outside public openings,
  anything under a GC NDA beyond what is needed to bid.

---

## 28. Audit trail

`recordAudit` on every write, `entityType` in `Organization`, `Contact`,
`Interaction`, `Qualification`, `QualificationRequirement`, `CompanyDocument`,
`BidInvitation`, `BidSubmission`, `PartnerSettings`; actions `create, update,
delete, stage_change, owner_change, qualification_status, requirement_decision,
document_upload, document_version, document_view, confidentiality_change,
bid_status, bid_decision, bid_submitted, bid_revised, bid_outcome, bid_award,
settings_update`. The GC page's Activity tab merges interactions, stage history,
tasks, the org's bid events and (for ADMIN/MANAGER) audit rows, the
`readActivity` pattern from violations. Richard's list — qualification status,
bid amount, submitted, revised, won/lost, contract value (job pricing is already
audited as `pricing_update`), owner changed, document replaced — is fully
covered.

---

## 29. MVP — Stage 1: "Who we are courting" (~1 day)

Organizations (with GC profile columns), contacts, six-stage enum + derived
badges, owner and priority, interactions with required outcome, follow-up rules
1, 2 and 5 as tasks (3–4 need Stage 2), `Task.organizationId` and the subject
chip, the Business Development sidebar section, ⌘K groups, contact-lookup
matches, `Lead.kind` + `organizationId` + `contactId` with the six-surface
fence and its test, `customerName()` tweak, `PartnerSettings` (thresholds,
owners, markets), seeds (Plumbing / Demolition / General Construction
categories, "GC bid invitation" source, settings row), the Coastal Choice
backfill script (dry run by default, idempotent, prints JOB-00009's
`billingMethod` and patches it only under a flag), feature doc, tests.

Week-one value: a target list with owner, stage, last touch and an overdue
follow-up on the dashboard, workable from a phone, and JOB-00009 attached to a
real GC. Everything later needs `Interaction.occurredAt` from day one.

## 30. Phase 2 — Stage 2: prequal and the vault (~1.5 days)

`CompanyDocumentType` seed, `CompanyDocument` with versions / expiry /
confidentiality / encryption / audited download, `Qualification` +
requirements with the default set, qualification-state derivation, rules 3–4,
expiry alert cron, attention rows, calendar overlays (`company_doc`,
`qualification_date`), the RESTRICTED grant, Qualifications and Vault pages,
tabs on the GC page.

## 31. Phase 3 — Stage 3: bids (~2 days)

`BidInvitation` + `BidSubmission`, bid lead creation in one transaction,
transition table, bid/no-bid score with versioned weights, decision dialog,
submissions, outcomes, `createJobFromLead` options and the award path, the lead
stage route guard, Bid tab on the lead page, Bids list/board, `bid_date`
overlays, "Bids due" and "Awaiting decision" attention rows, search labels.
Then enter JOB-00009's invitation retroactively (the backfill does it).

## 32. Long-term roadmap

| Phase | Scope | Notes |
|---|---|---|
| 4 (Stage 4, ~1 day) | Health score, scorecard, GC Performance tab, `/partners/analytics` with presets, admin weights page, BD KPIs by week/month/quarter/year | all deterministic |
| 5 | ITB email intake: forward platform mail to the intake mailbox; sender-based dispatcher in `intake-service.ts`; `parseItbEmail` → invitation `needsReview`; unmatched → task | `IntakeSettings.allowedSenders` exists |
| 5b | BuildingConnected via APS (3-legged OAuth, one authorising user, refresh token server-side; Opportunities needs Bid Board Pro) → invitations by external id; Procore only per-GC when a GC grants sub access; SmartBid/PlanHub/ConstructConnect email-only; TradeTapp read-only (we are the vendor, nothing to read); Textura manual | research in §26 of the brief; no API assumed |
| 6 | Opportunity discovery (permits, agendas, public bids) → `TRACKING` invitations with `signalSource` and a review queue | §20 |
| 7 | AI: score explanations, follow-up drafts, ITB field proposal, BD questions over the scorecard, contract-provision flags | generalised `runAiCall` |
| 8 | Package assembly (zip of current approved docs per GC's requirement set), estimating-hours capture per task, `Organization.kind` beyond GCs with the same contacts / interactions / rules | |

---

## 33. Risks

| Risk | Mitigation |
|---|---|
| A missed `kind` guard leaks bids into customer metrics or nurture | Six named call sites, a test on `buildLeadListWhere`, a grep checklist in the feature doc |
| Leads board drag or any `LEAD_STAGE_CHANGED` path desyncs a bid | Stage route refuses `GC_BID` moves; bid status is the master |
| `createJobFromLead` side effects on award (deposit task, residential defaults) | Options argument inside the function, not a patch after |
| Schema merge with `takeoff-m3` (uncommitted schema diff, unapplied `20261022120000_plan_ai_calls`) | Build on a branch from `main`, number the migration later, expect a merge |
| Data-entry burden at 7 users | One daily form (interaction with outcome); everything else derived; tasks nag only owners |
| Stale or gamed scores | Computed on read, dormant cap, decision score snapshotted with weights version |
| Confidentiality of the vault | Grant + audit + encryption at rest + no bank fields |
| Scope creep into a second CRM | The module reuses Lead, Task, File, Estimate, Job; the moment `Contact` is proposed for homeowners or a BD-only task list, stop |
| `customerName()` shows the estimator as JOB-00009's customer | Label tweak ships in Stage 1 |
| Non-race-safe job numbering (`nextJobNumber` in-process counter) | Pre-existing; awards are rare, but note it |

---

## 34. Features NOT recommended

- A separate `Opportunity` or `Project` entity (the bid lead is the opportunity; the Job is the project).
- Extending `Vendor` with a GENERAL_CONTRACTOR kind (payee matching would auto-link expenses to the GC; SALES_REP cannot see vendors).
- Widening `Communication`/`ActivityLog` to optional `leadId` (89 call sites assume a lead; nurture treats any communication as a customer touch).
- A `GcProfile` 1:1 table (no such pattern in the repo; wide nullable tables are the convention).
- An editable pipeline-stage table (reproduces the name-coupling the lead stages already suffer).
- Richard's 18 stages as hand-moved states (most are facts the CRM can derive).
- `BidInvitation` statuses for "waiting on supplier/sub" (a text note or a task).
- Drip or nurture email to GC contacts; any automation that sends without a person.
- AI contributing points to a score, or choosing the recommendation band.
- A public subcontractor profile or GC-facing portal.
- Bulk import of purchased GC lists on day one.
- A timer for estimator hours (one number field at decision/submission time).
- Charts before ~20 invitations exist.
- Platform integrations before volume justifies the OAuth plumbing.
- Own-only visibility scoping for partners at 7 users.
- Storing banking / EIN / SSN values, portal passwords, or NDA material.

---

## 35. Implementation sequence

1. **Branch `partners-s1` from `main`** (not from `takeoff-m3`). Schema +
   migration (`2026102x_partners_core`, hand-appended CHECKs / partial index),
   `prisma/seed-partners.ts`, pure libs with tests (`stages`, `derive`,
   `follow-ups`, `query`, `access`), services, routes, pages, sidebar, ⌘K, the
   fence (six call sites + test), `Task.organizationId` plumbing, backfill
   script, feature doc. Gate: typecheck, lint ≤ baseline, tests, build.
   Dev QA by API script + headless Chromium at 1280/400. Deploy with the env
   override; run the seed (dry run first) and the backfill (dry run first) on
   prod; install nothing on cron yet (rules need the follow-ups cron — install
   `partner-follow-ups.sh` and run once by hand).
2. **`partners-s2`**: vault + qualifications (migration with the grant column,
   seed of document types, cron wrapper, attention rows, overlays).
3. **`partners-s3`**: bids (migration with the sequence and CHECKs,
   `createJobFromLead` options, stage-route guard, Bid tab, board, overlays,
   rows). Retro-enter JOB-00009's invitation.
4. **`partners-s4`**: scoring, analytics, admin weights page.
5. Richard's click-through after each deploy; the next stage starts only then.

Each stage carries a migration; each stage's deploy follows the standard
runbook (backup, migrate, smoke 307 ×2, journal clean).

---

## 36. Testing strategy

- **Pure vitest per module file** (colocated `*.test.ts`): `stages`, `derive`
  (every badge), `follow-ups` (each rule's trigger / settle / period key;
  working days across a weekend), `qualification-state`, `document-alerts`
  (copied vendor cases), `bid-state` (every transition, CHECK invariants),
  `bid-score` (gates, neutral unknowns, snapshot shape, weights version),
  `health` (bands, dormant cap, null inputs, config override), `scorecard`
  (fixture rows including unlinked payments), `windows`, `access` (role ×
  capability matrix), `query`; `src/lib/leads/query.test.ts` extended for the
  fence; `createJobFromLead` option defaults.
- **API QA script per stage** (the "API n/n" pattern): org → contact →
  interaction → rule run raises once → second run raises nothing → interaction
  settles; SALES_REP 403 on decide and on RESTRICTED; MANAGER without grant 403,
  with grant 200 + audit row; award creates a PROGRESS job with 10% retainage
  and no deposit task; a `GC_BID` lead is absent from `/api/reports` counts,
  from the nurture dry run and from `/api/leads` by default; stage route 409.
- **Headless Chromium** at 1280 and 400 px: `/partners`, every GC tab, the
  interaction dialog, the decision dialog, the Bid tab on a lead, the vault
  upload; no console errors.
- **Seeds idempotent** (second run "unchanged"); backfill aborts if the org
  exists; rehearsed on a dev restore of a prod dump before prod.

---

## 37. Migration strategy

- Hand-applied (`migrate diff` → `db execute` → `migrate resolve`), one
  migration per stage; enum `ADD VALUE` statements never share a transaction
  with inserts that use them (Postgres rule).
- `Lead.kind NOT NULL DEFAULT 'CUSTOMER'` backfills itself; `organizationId`,
  `contactId`, `Task.organizationId` nullable with `ON DELETE SET NULL` and
  indexes (the `vendor_id` precedent).
- Backfill script `scripts/backfill-partners-coastal-choice.ts`: find
  JOB-00009 and its lead; upsert Organization on `nameKey "coastal choice
  construction"` (kind GC, HQ from the lead's mailing address, stage ACTIVE,
  trade Drywall); patch the lead (`kind GC_BID`, `organizationId`); Stage 3
  adds the CLOSED/AWARDED invitation ($832,500, outcome 2025-03-07) and one
  ORIGINAL submission; prints `billingMethod`/`retainagePercent` and patches to
  PROGRESS/10 only under `--fix-billing` (the import never set them).
- Nothing else to backfill: prod has 0 vendors, no commercial leads besides
  this one (to be confirmed by the read-only probe in the appendix).
- Rollback = the deploy's DB backup; no destructive statements in any stage.

---

## 38. Final recommendation

Build it as four stages on the Lead → Job spine, starting with Stage 1 this
week. The architecture adds five real entities and two small Lead/Task
extensions, reuses every estimating, document, task, calendar and money
component already on prod, and keeps scoring and automation deterministic and
auditable. The three rulings to take before Stage 1 starts: the six-stage enum
(recommended) versus editable stages; SALES_REP managing partners and who reads
RESTRICTED documents; and acceptance of the bid-as-Lead consequences (bids live
under Business Development, hidden from Leads by default, no automated mail to
estimators, one job per package with progress billing on award).

---

## Answers to the final questions

1. **Reusable without modification**: Task and its create/update/close
   services, File on leads, both estimate builders, takeoff, Roofr, job
   creation (with an options argument), workflows, `getJobCostRows`, AR aging,
   audit, keyring, cron auth, settings/seed patterns, sequences, every UI
   primitive and list/board/kanban kit, the calendar and attention frameworks.
2. **Extend**: `Lead` (kind, organizationId, contactId; label select), `Task`
   (organizationId, subject label, chip), `createJobFromLead`, the lead stage
   route, six customer-only queries (the fence), `CalendarKind`, attention rows,
   search, sidebar, `User` grant, intake dispatcher (later), working-day helper.
3. **Genuinely new**: Organization (+trades, stage history), Contact,
   Interaction, Qualification + requirements, CompanyDocumentType,
   CompanyDocument vault, BidInvitation, BidSubmission, PartnerSettings, the
   follow-up planner, the two scorers, the scorecard, the windows helper.
4. **Smallest useful MVP**: Stage 1 (§29).
5. **Not in MVP**: vault, qualifications, bids, scores, analytics,
   integrations, AI.
6. **First sprint**: Stage 1 with the fence and the backfill.
7. **First 30 days**: Stages 2 and 3.
8. **First 90 days**: Stage 4, ITB email intake, then promote manual sliders to
   AUTO as real data accumulates.
9. **Most immediate value**: the target list with last touch and overdue
   follow-ups on the dashboard; then vault expiry alerts (an expired COI is how
   a prequal dies silently).
10. **Collect now**: every date — `Organization.createdAt/stage/owner`,
    `Interaction{kind, direction, outcome, occurredAt, contactId}`,
    `Qualification{submittedAt, approvedAt, expiresAt}`,
    `BidInvitation{invitedAt, bidDueAt, decidedAt, decision, submittedAt,
    estimatingHours, outcome, outcomeAt, lossReason, winningPrice,
    contractReceivedAt}`, `BidSubmission{amount, submittedAt}`; and, on the
    money side, `Payment.invoiceId` + the real `receivedDate`.
11. **Deterministic vs AI**: all scores, rules, KPIs and recommendations
    deterministic and config-driven; AI only explains, drafts and proposes
    fields for confirmation.
12. **Security to resolve**: the RESTRICTED grant and audit; encryption at rest
    for RESTRICTED blobs; estimator access to ITB files via lead assignment; no
    banking fields; rate-limited download route.
13. **Reuse for other relationships**: `Organization.kind` already carries
    developers, property managers, architects, engineers, municipalities and
    referral partners with the same contacts, interactions, stages, rules 1, 2
    and 5, vault sharing and health sections A–B. Qualification and bids apply
    to kinds that issue work (GC, developer, PM, municipality). Suppliers stay
    `Vendor` with an optional `Organization.vendorId` link rather than a merge;
    today's customer `Referral` rows stay where they are.

---

## Appendix A — Bid-platform research (sources)

- BuildingConnected & TradeTapp APIs on Autodesk Platform Services: v2, REST,
  3-legged OAuth only; Opportunities (the sub's inbox of invitations) require a
  Bid Board Pro subscription; invites issued through BC Pro become opportunities
  on Bid Board. https://aps.autodesk.com/en/docs/buildingconnected/v2/developers_guide ·
  https://aps.autodesk.com/en/docs/buildingconnected/v2/developers_guide/field_guide ·
  https://aps.autodesk.com/blog/buildingconnected-write-api-released
- TradeTapp API: read-oriented vendor data (demographic, contact, project,
  financial, safety, insurance) through APS. https://www.autodesk.com/products/tradetapp/overview
- Procore: bid packages / bids endpoints exist (`/rest/v1.1/projects/{id}/bid_packages/{id}/bids`,
  `bid_status undecided|will_not_bid|will_bid|not_invited|submitted`), but they
  are the GC's tenant; a sub sees them only with access granted by that GC.
  Third-party references only; verify on developers.procore.com before relying.
- SmartBid advertises an open API and a ConstructConnect/Procore integration;
  PlanHub and ConstructConnect publish no developer docs found; Oracle Textura
  REST docs are for Payment Management and sit behind an Oracle login;
  "COMPASS" prequal was not confirmed to have an API.
  https://www.constructconnect.com/products/smartbid ·
  https://docs.oracle.com/cd/E97085_01/English/api/index.html
- Conclusion: manual entry with `platform` + link now; email forwarding of ITBs
  into the intake mailbox as the first automation; BuildingConnected OAuth when
  volume justifies it. Never scrape a platform.

## Appendix B — Read-only prod probe for Richard

The permission classifier refused the session's prod read. The same SQL (all
`SELECT`s) is checked in as `docs/project-memory/gc-probe-2026-10-13.sql`; run
it with `!` as:

```
scp docs/project-memory/gc-probe-2026-10-13.sql knuco-droplet:/tmp/gc-probe.sql && ssh knuco-droplet 'set -a; . /etc/knuco/env; set +a; psql "${DATABASE_URL%%\?*}" -f /tmp/gc-probe.sql'
```

It reports lead/job/vendor/invoice/payment/communication counts, leads by
company name, source and stage, the commercial or progress-billed jobs, and
the invoice/payment columns — the numbers §37's "nothing else to backfill"
assumes.
