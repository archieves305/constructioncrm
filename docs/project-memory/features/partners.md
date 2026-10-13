# Business Development — GC Partnerships

_Stage 1 built + deployed 2026-10-13 (`b8af730`); Stage 2 built 2026-10-13 on
`partners-s2`. Design:
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

## Next

Stage 3: bid invitations on `GC_BID` leads, decisions, submissions,
outcomes, award → progress-billed job. Stage 4: health score, scorecard,
analytics.
