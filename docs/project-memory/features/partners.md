# Business Development — GC Partnerships

_Stage 1 built 2026-10-13 on `partners-s1`. Design:
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

## Next

Stage 2: qualifications + the KNU document vault + expiry alerts +
RESTRICTED access. Stage 3: bid invitations on `GC_BID` leads, decisions,
submissions, outcomes, award → progress-billed job. Stage 4: health score,
scorecard, analytics.
