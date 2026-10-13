# Business Development — GC Partnerships

_Stage 1 deployed 2026-10-13 (`b8af730`); Stage 2 deployed 2026-10-13
(`65cc01e`); Stage 3 (bids) deployed 2026-10-13 (`d2afb6f`); Stage 4 (health, scorecard,
analytics) built + dev-QA'd 2026-10-13 on `partners-s4`. Design:
`CAREYOS_GC_PARTNERSHIPS_IMPLEMENTATION_PLAN.md` and
`CAREYOS_GC_PARTNERSHIPS_BUILD_SPECIFICATIONS.md` at the repo root._

## What it is

The accounts KNU courts for work — general contractors first, then
developers, property managers and the rest — with the people at them, every
touch logged, one relationship owner each, a six-stage pipeline, and
follow-up tasks the rules raise when an account goes quiet. It is not a
second CRM: a GC's bid packages are **Leads of kind `GC_BID`** (Stage 3), so
the estimators, takeoff, files, tasks and job creation work on them unchanged.

## Model (Stage 1)

| Table | Holds |
|---|---|
| `organizations` | The account: identity, HQ, markets[], GC profile columns (volume, platforms, requirements), `stage` (`PartnerStage` enum), `ownerUserId`, `priority`, `lastContactAt` (max interaction), `nextFollowUpAt` (display), optional `vendorId` link. `nameKey` = normalised name, unique — the duplicate guard. |
| `organization_trades` | Account ↔ `ServiceCategory`. |
| `contacts` | People at an account: role tag, phones, email, LinkedIn, ratings 1–5 (CHECK), one primary per account (partial unique index), `lastContactAt`. |
| `interactions` | One touch: kind, direction, outcome, when, summary, who; optional contact and lead. |
| `partner_stage_history` | From/to/reason/who. |
| `partner_settings` | Singleton: the five thresholds, `dormantAfterDays`, default owner, markets. |
| `leads.kind`, `leads.organization_id`, `leads.contact_id` | The fence and the link. |
| `tasks.organization_id` | A task about an account. |

Migration `20261023120000_partners_core` (hand-appended CHECKs and the
partial index). Seed `prisma/seed-partners.ts` (Plumbing / Demolition /
General Construction categories, the "GC bid invitation" source, the
settings row — all create-only).

## Rules of the module

- **Stages are an enum** (`lib/partners/stages.ts`): TARGET → CONTACTED →
  ENGAGED → ACTIVE, plus DORMANT and DO_NOT_PURSUE (closed; a reason is
  required to write off, ADMIN/MANAGER only). Everything else about an
  account — quiet, never contacted, prequalified, bidding, awarded, repeat —
  is derived on read (`derive.ts`), never a stage someone must move.
- **Vendor is not an Organization.** Vendors are payees (matched against
  expense payees); an account that is also a payee links through
  `vendorId`, never merges.
- **Interactions are the daily input.** `logInteraction` moves the
  account's and the contact's `lastContactAt`, writes an `ActivityLog` row on
  the lead when the touch is about a bid, creates the optional follow-up task
  and settles the account's open engine follow-ups.
- **Follow-ups are ordinary tasks** raised once per source key
  (`org:<id>:followup:<rule>@<anchor>#<period>`) by the daily cron and
  settled on every interaction or stage write — the vendor alert pattern.
  Stage 1 rules: `new-target` (TARGET, no interaction, N working days),
  `no-response` (last outbound touch unanswered, N days), `quiet` (ACTIVE,
  N days silent). Rules 3–4 (`qual-submitted`, `prequal-no-bids`) are planned
  and wait for Stage 2's inputs. Assignee: the owner → the settings' default
  owner → the oldest admin. Nothing is ever sent to the GC.
- **The fence.** `Lead.kind` defaults to CUSTOMER; `buildLeadListWhere`,
  nurture enrolment, `emitLeadEvent`, the overdue-follow-ups row, the
  dashboard lead counts and the funnel cohort all filter on it; search labels
  a bid lead "Bid · <GC>". `customerName()` prefers the company on a bid
  lead. Any new reader of leads that means homeowners must add
  `kind: "CUSTOMER"`.
- **Access** (`lib/partners/access.ts`): view = office roles + SALES_REP +
  MARKETING + READ_ONLY; manage (create, edit, log, move stages) = ADMIN /
  MANAGER / OFFICE_STAFF / SALES_REP; admin (owner change, write-off, delete,
  settings) = ADMIN / MANAGER. No own-only scoping: Mine on the list is a
  convenience filter on owner, not a floor.
- **Every write is audited** (`Organization`, `Contact`, `Interaction`,
  `PartnerSettings`): create / update / delete / stage_change /
  owner_change / deactivate.

## Surfaces

Sidebar section **Business Development** (GC Partnerships, Contacts) and
Admin → Business Development (`/admin/partners`). `/partners` (table | board,
Mine/All, search, stage / owner / market / trade / kind filters, CSV);
`/partners/[id]` (header with the stage stepper, Overview · Contacts ·
Activity; Log interaction is the brand action and sticks to the bottom on a
phone); `/partners/contacts`. ⌘K groups "GC partners" and "Contacts";
contact-lookup returns `contacts` for a calling estimator. Attention row
`partner-follow-ups` (OFFICE + SALES_REP). Task chip kind `organization`.

## Routes

`/api/partners` (GET, POST) · `/[id]` (GET, PATCH, DELETE) · `/[id]/stage` ·
`/[id]/owner` · `/[id]/contacts` (GET, POST) · `/[id]/interactions` (GET,
POST) · `/api/contacts/[id]` (PATCH, DELETE = deactivate) ·
`/api/interactions/[id]` (PATCH, DELETE) · `/api/partners/contacts` ·
`/api/partners/settings` (GET, PUT) · `/api/partners/options` ·
`/api/cron/partner-follow-ups` (`?dryRun=1`).

## Operator

- Seed: `npx tsx prisma/seed-partners.ts` (prints created / unchanged).
- Backfill: `scripts/backfill-partners-coastal-choice.ts` (dry run; `--apply`;
  `--fix-billing` only on Richard's word after reading the printed values).
- Cron: `crm-cron/partner-follow-ups.sh` at `55 11 * * 1-5` (after
  vendor-compliance); run once by hand after the deploy.

## Stage 2 — qualifications and the document vault

| Table | Holds |
|---|---|
| `company_document_types` | The kinds of document a GC asks for (W-9, GL COI, … 16 seeded by `key`, admin-editable with `category` and `defaultValidityMonths`). |
| `company_documents` | KNU's own documents, versioned per type (`@@unique(documentTypeId, version)`, append-only; the current version is the highest). Own storage columns, never a `File` row: `confidentiality` INTERNAL / RESTRICTED / SHAREABLE, `approvedForExternal`, dates, `encryptedKeyVersion` (non-null = the bytes on disk are AES-GCM under the field keyring, AAD `company-document:<id>`). |
| `qualifications` | One prequalification with an account: platform, portal URL + username hint (never a password), owner, hand-moved `status` (NOT_STARTED … APPROVED / REJECTED), submitted / approved / expires / renewal dates. |
| `qualification_requirements` | The checklist: one line per document type, `required`, the GC's answer (`status` PENDING / ACCEPTED / REJECTED / WAIVED), the attached vault version, `providedAt`. |
| `partner_settings` + | `vaultOwnerUserId`, `defaultRequirementTypeKeys`. |
| `users.can_view_restricted_documents` | The grant (Admin → Users). |

Migration `20261024120000_partners_qualifications` (CHECKs: version ≥ 1,
expiry ≥ effective). Seed adds the 16 types and fills an empty default
checklist once.

Rules:
- **Derived, never stored**: EXPIRED and RENEWAL_DUE come from the dates
  (`qualification-state.ts`); a requirement is "missing" because no document
  is attached, "provided" because one is, "expired" because that document is;
  ACCEPTED / REJECTED / WAIVED are the GC's answer. `coverage()` counts the
  required lines satisfied (accepted, provided in date, or waived).
- **Who may open what** (`vault-access.ts`): SHAREABLE = every Business
  Development viewer; INTERNAL = the same minus MARKETING; RESTRICTED = ADMIN,
  or MANAGER / OFFICE_STAFF with the grant. Filing is ADMIN / MANAGER /
  OFFICE_STAFF; filing RESTRICTED needs the right to read it; classifying,
  approving for external distribution, deleting and editing the type list are
  ADMIN / MANAGER. A document the viewer may not open is listed `locked` and
  its file route answers 404. A RESTRICTED read is audited `document_view`
  with IP and user agent. The bytes route is rate-limited (60/min/user),
  `no-store`, and the only route that serves them; it is framed by the app
  itself (`FRAMED_BY_SELF` in `next.config.ts`).
- **RESTRICTED needs `FIELD_ENCRYPTION_KEYS`** (503 otherwise). Moving a
  document into or out of RESTRICTED re-writes the bytes. A rotation sweep
  for blobs is not written yet (`scripts/rotate-field-encryption.ts` covers
  fields only).
- **A version attached to a requirement cannot be deleted** (409); detach
  first. Deleting re-links the chain (`supersedesId`).
- **Alerts are tasks** (`document-alerts.ts` + `document-alert-run.ts`,
  the vendor pattern): the current version of a type inside 30 days of its
  expiry → HIGH due 14 days before, lapsed → URGENT (cancels the reminder);
  an APPROVED qualification expiring / expired / past its renewal day. Keys
  `company-doc:<docId>:<kind>@<day>` (no entity link; the description names
  the type and the accounts using it) and `org:<id>:qual:<qid>:<kind>@<day>`
  (on the account, assigned to its owner). Vault tasks go to the vault owner
  → ACCOUNTING default → oldest admin. Every document and qualification
  write settles. Cron `/api/cron/company-document-alerts`.
- **Follow-up rules 3–4 are live** now that `representativeQualifications`
  feeds the planner: `qual-submitted` (SUBMITTED N days) and
  `prequal-no-bids` (APPROVED, ENGAGED / ACTIVE, N days since approval or
  bid activity — the latter arrives with Stage 3).
- On → APPROVED with no expiry, the expiry defaults to the approval date plus
  the longest `defaultValidityMonths` among the required lines.

Surfaces: `/partners/vault` (by category, current version + history, lock /
Shareable / approved-to-send badges, upload through the real picker with the
expiry prefilled from the type's validity, in-place preview, download, menu
to reclassify / approve / delete); the account's **Qualification** tab (cards
with status select, progress, checklist rows with "Mark sent" when the vault
holds a newer or unattached current version, "File it" when the vault has
nothing of that kind, the GC's answer, waive, optional, detach, add a line)
and **Documents** tab (what this account has been sent, superseded versions
flagged); `/partners/qualifications` (queues: submitted / info requested /
expiring 90 d / expired, CSV); Admin → Business Development gains the vault
owner and the default checklist; Admin → Users gains the grant; attention rows
`qualifications-expiring` (PRODUCTION) and `company-docs-expiring` (OFFICE);
calendar overlays `company_doc` and `qualification_date`.

Routes: `/api/company-documents` (GET, POST multipart) · `/[id]` (GET meta +
usedBy, PATCH, DELETE) · `/[id]/file` (GET; `?download=1`) · `/types` (GET,
POST upsert) · `/api/partners/[id]/qualifications` (GET, POST) ·
`/api/qualifications` (GET; `status`, `derived`, `expiringWithinDays`) ·
`/[id]` (GET, PATCH, DELETE — 409 while APPROVED) · `/[id]/requirements`
(POST) · `/[id]/requirements/[rid]` (PATCH, DELETE) ·
`/api/cron/company-document-alerts`.

Operator: seed again after the deploy (16 types created; default checklist
filled); `crm-cron/company-document-alerts.sh` at `56 11 * * 1-5`.

## Stage 3 — bids

Migration `20261025120000_partners_bids`: `BidInvitation` (1:1 with a
`GC_BID` lead, `BID-nnnnn` from `bid_invitation_number_seq`, dates, flags,
platform, status, decision + score + snapshot, outcome, estimating hours),
`BidSubmission` (append-only versions), seven enums, scoring columns on
`PartnerSettings` (`scoreWeights` + `scoreWeightsVersion`, `ourTradeIds`,
`homeCounties`, `adjacentCounties`, `typicalRange`, `bondingCapacity`).
CHECKs: outcome only when CLOSED, awarded amount only when AWARDED, score
0–100, a submission links at most one estimate, version ≥ 1.

Rules:

- **A bid package is a Lead of kind `GC_BID` plus its `BidInvitation`.**
  `createBid` writes both in one transaction (contact or account fill the
  person columns, the site fills the address, `primaryPhone` falls back to
  "N/A", source "GC bid invitation", assignee = estimator → account owner →
  actor) and logs the invitation as an inbound interaction.
- **Status is the master; the lead's stage mirrors only Won and Lost.** The
  lead stage route answers 409 for a `GC_BID` lead. `moveLeadStage` in
  `bids.ts` writes history, activity and audit, and never fires the lead
  event (no nurture, no rule mail). The stepper is hidden on a bid lead; the
  nurture card too.
- **Transitions** (`bid-state.ts`): forward, the corrections back
  (SUBMITTED → ESTIMATING for a revision), CLOSED only through `/outcome` or
  a NO_BID decision, reopen only from CLOSED. SUBMITTED needs a submission.
  "Waiting on" is a note while ESTIMATING, not a state.
- **The score is advice** (`bid-score.ts`, pure): relationship 15 (neutral
  until Stage 4's health score), size vs the trade's usual range 10, trade fit
  10 (none = hard NO_BID), market 10, lead time 5, payment history 10, win
  rate with the GC 5 (needs 3 decided), lapsed insurance −5, five 1–5 sliders
  (margin, capacity ×2; competition, complexity, plans/terms ×1). A bond
  beyond capacity caps the recommendation at REVIEW. Bands: ≥ 70 BID, ≥ 50
  REVIEW. Every decision stores the score, the inputs and the weights version.
  Admin → Business Development → Bid scoring sets the trades, counties, size
  ranges and bonding capacity; the point values stay coded until Stage 4.
- **Who:** view = partner viewers; log / edit / move / submit / record a
  loss = ADMIN, MANAGER, OFFICE_STAFF, SALES_REP; decide, award, reopen,
  delete = ADMIN / MANAGER. **Every bid route and the list are lead-scoped**
  (`bid-guard.ts`, `leadAccessWhere`): a sales rep sees the bids they
  estimate, raised, or whose lead is theirs.
- **Award → job** through `createJobFromLead(…, { billingMethod: PROGRESS,
  retainagePercent: 10, depositRequired: 0, skipDepositTask: true,
  contractAmount, title })`. `createJobFromLead` also picks these defaults by
  itself for any `GC_BID` lead (the hand-moved Won path is closed anyway).
  Reopening an awarded bid needs `force` and leaves the job.
- A submission snapshots the linked estimate's price and cost (margin at bid
  time); only a manager may delete one, within a day.
- Delete only a bid never worked (TRACKING / INVITED, no submission, no
  estimate, plan set or file on its lead) — the lead goes with it.

Surfaces: the lead's **Bid** tab (first, default; facts, dates, Bid or pass
card with live score and sliders, What went out, Outcome, Move to… / Record
submission / Close… / Reopen), header = project + `BID-nnnnn`, breadcrumb
Bids; `/partners/bids` (12-month KPI strip from `scorecard.ts`, list | board,
All | Mine, search by project / GC / number, Show closed, CSV, Log a bid);
the account's **Bids** and **Projects** tabs and a Log a bid button; attention
rows `bids-due` (PRODUCTION, 7 days) and `bids-awaiting-decision`
(ADMIN / MANAGER); calendar overlay `bid_date` (due, site walk, pre-bid, RFI,
addenda, interview, award expected); ⌘K and the Leads search find a bid by
number or project; badges Bidding / Bid received / Awarded / Repeat work.
Fixed on the way: the lead page widened past a phone screen on every lead
(grid columns lacked `min-w-0`).

Routes: `/api/bids` (GET, POST) · `/[id]` (GET, PATCH, DELETE) ·
`/[id]/status` · `/[id]/decision` (GET preview with slider query, POST) ·
`/[id]/outcome` · `/[id]/reopen` · `/[id]/submissions` (POST) ·
`/[id]/submissions/[sid]` (DELETE).

Operator: no seed and no cron. After the deploy, fill Admin → Business
Development → Bid scoring (trades, counties, size ranges, bonding), then
`scripts/backfill-partners-bid-job00009.ts` (dry run, then `--apply`) records
JOB-00009's award as BID-00001 — CLOSED / AWARDED at the original contract,
no score, no invented submission.

QA (dev, 2026-10-13): API 48/48; headless Chromium 25/25 at 1280 and 400 px
(log a bid through the dialog, sliders move the score, decide, submit, lose,
reopen, award → job, account tabs, list / board, attention list); roles —
SALES_REP 15/15 (sees only own bids, 404 on others, 403 on decide / award /
reopen / delete), READ_ONLY and CREW_LEAD cannot write; backfill dry run /
apply / re-run on a stand-in job. QA rows removed.

## Stage 4 — health, scorecard, analytics

Migration `20261026120000_partners_scorecard`: `PartnerSettings` gains
`healthWeights` + `healthWeightsVersion`, `preferredMinAwards` (2) and
`preferredMinMargin` (0.20), with a CHECK on their bounds. No new table.

Pure modules:

- `health.ts` — relationship health 0–100 (plan §17): engagement 30 (last
  touch, meetings in 12 months, touches in 90 days), qualification 20, bid
  flow 25 (invitations, half submitted, awards), economics 25 (billed in 12
  months, projected margin, days to pay). A touch-less account past
  `dormantAfterDays` (180) is held at `dormantCap` (40). Bands Strong ≥ 80,
  Active ≥ 60, Developing ≥ 40, Cold ≥ 20, Dormant. Strengths = sections at
  ≥ 70 %, weaknesses = factors under half their points, the action = the first
  match of expired prequal → expiring → quiet → unbid invitations → slow payer
  → keep the cadence. The plan's worked example scores 76 in the tests.
- `windows.ts` — presets (30 d, 90 d, 12 mo, month, quarter, YTD, year, last
  year, custom) on office-day keys, period buckets (week from Monday, month,
  quarter, year).
- `scorecard.ts` — money KPIs: billed and collected in the window; contract,
  projected profit and margin over **jobs active in the window** (created or
  billed there); days to pay over linked payments with the unlinked ones
  counted and reported; retainage held (a balance); change-order approval
  rate; profit per estimating hour on awards and on every bid; `groupBy`.
- `derive.ts` — "Preferred": awards ≥ the setting at a margin ≥ the setting.

Loaders (`scorecard-load.ts`): `loadHealth(orgIds)` in a fixed number of
queries (used by the accounts list, the account page and the bid score — its
relationship slot is live now); `loadOrgScorecard`; `loadAnalytics` (by GC,
trade — a bid's package trades, a job's bid's trades, else the account's —
market or owner; groups with nothing in the window are left out); BD
activity per period; the dashboard summary.

Routes: `GET /api/partners/[id]/scorecard?preset=&from=&to=` and
`GET /api/partners/analytics?preset=&groupBy=&period=&stage=&market=`
(`&csv=1` → CSV) for ADMIN / MANAGER / OFFICE_STAFF / READ_ONLY
(`canViewPartnerMoney`); `GET /api/partners/summary` (ADMIN / MANAGER);
`POST /api/partners/[id]/action-task` (partner managers: the recommended
action becomes a task for the owner, due in three working days). Settings PUT
takes `healthWeights` (validated by the scorer's schema), the Preferred
thresholds; a weights change bumps its version, compared key-order-independently.

UI: health pill on the account header (strength / weakness on hover) and a
**Performance** tab (health card with section meters, factor notes,
strengths, weaknesses, next step + Create task; window presets + custom;
twelve KPI cards for money roles, a note for the rest); Health column on the
accounts list, sortable; `/partners/analytics` (KPI row, pipeline strip
linking to the filtered list, billed / profit and win-rate charts, group
table, BD activity by period, CSV); Admin → Weights (both rule sets as JSON,
Reset to defaults, Preferred thresholds); a Business development strip on the
dashboard for ADMIN / MANAGER (open bid value, bids due this week, partner
follow-ups overdue).

Fixed on the way: recording a back-dated submission, or a bid with a past
invitation date, moved the account's last contact backwards
(`advanceLastContact` is forward-only now); the account page's tab strip ran
off a phone screen.

QA (dev, 2026-10-13): API 31/31 on an account with an awarded progress job, a
budget (25 % margin), an invoice paid 45 days later and an unlinked payment;
headless Chromium 23/23 at 1280 and 400 px; SALES_REP sees health but gets 403
on scorecard / analytics / summary / weights; READ_ONLY reads scorecard and
analytics. QA rows removed, dev settings reset.

## Next

Later phases from the plan: ITB email intake to the Outlook mailbox,
BuildingConnected OAuth, opportunity discovery, AI explanations of the health
breakdown (words only, never points), a nightly health snapshot for trend
lines.
