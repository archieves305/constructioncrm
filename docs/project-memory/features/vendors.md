# Vendors, subcontractor compliance, commitments (audit initiative 6)

Three stages, plan approved 2026-10-03
(`~/.claude/plans/encapsulated-frolicking-possum.md`). Stage 1 is on prod
(`ec88e96`, BUILD_ID `5x6HE43-USWkCl1cgP0Zn`, deployed 2026-10-03);
Stage 2 (compliance documents + expiry alerts) is on prod (`45899b2`,
BUILD_ID `DcJXs_PTMUJdAIU9AJO2p`, cron installed 2026-10-03); Stage 3
(commitments feeding committed cost) follows with its own migration.

Richard's rulings (2026-10-03): crews, typed contractors and suppliers are
**one directory**; a subcontractor needs a general liability COI, workers'
comp or exemption, and a W-9 (a license is tracked with its expiry when
recorded but is not required); a gap **warns and raises a task, never
blocks**; a commitment is a **simple record** (vendor, description, amount,
optional budget line, Open / Closed / Cancelled — no lines, PO document, bills
or approvals); expiry tasks go to the compliance owner set under Admin, until
then the Accounting role default, then the oldest admin.

## Stage 1 — vendor record + payee matching

Migration `20261013120000_vendors`: `Vendor` (name, kind `SUBCONTRACTOR |
SUPPLIER | OTHER`, trade, contact, phone, email, address, notes, isActive),
`VendorAlias` (normalised `pattern`, unique), and nullable `vendor_id` on
`job_expenses`, `crews` and `labor_contracts` (all `SET NULL`).

### Where things are

- `src/lib/vendors/match.ts` — pure, client-safe, tested: `normalisePayee`,
  `patternMatches` (the pattern must start at a word; the end is open because
  bank memos run the payee into the city), `matchVendor` (longest pattern
  wins), `aliasRows` (stored aliases + each vendor's own name), `groupPayees`.
  Patterns shorter than 3 characters never match.
- `src/lib/vendors/access.ts` — `canManageVendors` (ADMIN / MANAGER /
  OFFICE_STAFF), `canViewVendors` (+ READ_ONLY).
- `src/lib/vendors/service.ts` — `resolveVendorId` (used where an expense is
  written; never throws), `createVendor`, `updateVendor`, `addAlias` /
  `removeAlias`, `linkVendor` (payee, crew, or every contract typed under a
  label), `linkExpensesForVendor`, `linkAllExpenses` (the backfill),
  `listVendors`, `getVendorDetail`, `getUnmatched`,
  `vendorForLaborContract`, `laborContractsOfVendor`. Refusals are
  `VendorError` with a status. Everything that links is audited
  (`Vendor` / `Crew` entity, actions `create`, `update`, `alias_add`,
  `alias_remove`, `vendor_link`, `contract_label_link`).
- `src/lib/vendors/validation.ts` — zod schemas + `vendorErrorResponse`.
- Routes: `GET/POST /api/vendors`, `GET/PATCH /api/vendors/[id]`,
  `POST/DELETE /api/vendors/[id]/aliases`, `POST /api/vendors/[id]/link`,
  `GET /api/vendors/unmatched`, `GET /api/vendors/options` (any signed-in
  user; id, name, kind, trade for pickers and suggestions).
- UI: `/vendors` (Directory | Unmatched, URL `?tab=unmatched&kind=`),
  `/vendors/[id]`, `src/components/vendors/*` (`VendorFormDialog`,
  `LinkVendorDialog`, `VendorSelect`, `use-vendors.ts`). Sidebar Money →
  Vendors; ⌘K "Vendors" group (name, trade, contact or alias).

### How matching behaves

- An expense is matched when it is written: the cc-allocator intake, the
  manual create, and a PATCH that changes the payee text (a changed payee is
  matched afresh, so it can also unlink). Payroll-posted rows are never
  matched — their "vendor" is a worker's name.
- `JobExpense.vendor` is the payee as it arrived and is never rewritten;
  `vendorId` is the match. The job's expense list returns `vendorRecord`.
- Creating a vendor, renaming one, reactivating one or adding an alias links
  every unlinked expense it now matches. Removing an alias leaves existing
  links alone. An inactive vendor takes no new matches.
- An alias the vendor's name already catches is not stored.
- A labor contract's vendor is its own `vendorId`, else its crew's. A contract
  typed under a name that matches a vendor links on create; a contract under a
  crew stores none of its own.
- The Unmatched tab lists unlinked payee spellings (grouped by normalised
  text), active crews with no vendor, and contractor names typed on labor
  contracts with no vendor. Nothing is seeded — the directory is built there.

### Backfill

`scripts/link-expense-vendors-2026-10.ts` (dry run by default, `--yes`
applies, idempotent). Mostly redundant, because creating a vendor links its
expenses at once; run it after working the Unmatched tab to confirm 0 remain
matchable.

### Dev QA (2026-10-03)

API script 31/31 (create from payee linked 68 existing rows incl. a bank memo;
duplicate name 409; alias add linked the `HOMEDEPOT.COM…` memo; short alias
400; bank-feed and manual expenses attach on arrival; payee edit unlinks and
relinks; vendor from a crew and from a contract label; inactive vendor takes
no match; audit rows). Headless Chromium at 1280 and 400 px: directory,
Unmatched, new-vendor and link dialogs, vendor page, expense rows, labor
contract card, crew card, ⌘K → Enter; no console errors, no horizontal page
scroll. SALES_REP: 403 on every vendor route except `options`, and no vendor
hits in search. Backfill script: 3 → 3 → 0. Dev DB restored from a dump.
The cc-allocator intake was exercised on dev with a throwaway key.

### Prod, before Stage 1 (read-only, 2026-10-03)

456 expenses with 86 distinct payee strings (Home Depot under 9+ spellings);
11 crews (5 with labor contracts); 11 labor contracts totalling $680,141.31,
5 of them typed by name (BNW Construction $439,768.80, JDA Legacy $105,000,
Prime Surfaces $17,700, MTL Granite $1,872.50); license and insurance text
blank on all 11.

## Stage 2 — compliance documents + expiry alerts

Migration `20261014120000_vendor_documents`: `VendorDocument` (type
`GL_INSURANCE | WORKERS_COMP | WC_EXEMPTION | W9 | LICENSE | OTHER`, carrier,
policy number, effective and expiry days, optional stored file, notes),
`VendorSettings` singleton (`complianceOwnerUserId`), `tasks.vendor_id`.

### Where things are

- `src/lib/vendors/compliance.ts` — pure, client-safe, tested:
  `deriveCompliance(kind, docs, today)` → four requirements (liability,
  workers' comp, W-9, license), each `ok | expiring | expired | missing |
  not_recorded`, a verdict (`expired` > `missing` > `expiring` > `ok`;
  `not_required` for a supplier with nothing lapsing) and plain-words `gaps`.
  `docInForce` = the most recently **filed** document of a requirement's
  types (an exemption filed after a certificate replaces it). A W-9 never
  expires. The license is optional but an expired one counts.
- `src/lib/vendors/alerts.ts` — pure, tested: `alertsForVendor` (one alert per
  dated document in force: `expiring` inside 30 days, HIGH, due 14 days before
  expiry; `expired` once lapsed, URGENT, due today), `liveVendorAlertKeys`.
  Source key `vendor:<vendorId>:doc:<docId>:<kind>@<expiry day>`.
- `src/lib/vendors/alert-run.ts` — `complianceOwnerId` (the person set under
  Vendors → the `ACCOUNTING` workflow role default → the oldest active admin;
  an inactive person is passed over), `raiseVendorAlerts` (once per key; an
  `expired` task cancels its `expiring` one), `settleVendorAlerts` (closes
  open alert tasks the documents have overtaken; called on every document
  write).
- `src/lib/vendors/documents.ts` — create / update / delete (row first, then
  the file), dates stored as a day pinned at noon UTC, audited
  (`VendorDocument`).
- `src/lib/vendors/compliance-load.ts` — `complianceForVendors`,
  `vendorsNeedingDocuments` (the dashboard row's one query).
- Routes: `POST /api/vendors/[id]/documents` (multipart),
  `GET | PATCH | DELETE /api/vendors/[id]/documents/[docId]` (GET streams the
  file; vendor-view roles), `GET | PUT /api/vendors/settings` (PUT is ADMIN /
  MANAGER), `POST /api/cron/vendor-compliance` (`requireCronSecret`).
- UI: `components/vendors/compliance-card.tsx` on the vendor page (requirement
  tiles, document history, add / edit / remove), `document-dialog.tsx`,
  `compliance-badge.tsx` (`ComplianceBadge`, `ComplianceCallout`),
  `compliance-owner.tsx` (the "Expiry tasks go to …" control on `/vendors`),
  the list's pill and "Needs documents" filter (`?needs=1`).

### Where the warning shows (never a block)

- Labor contract card (above the buttons that pay the contractor) and the
  add-contract form once a crew is picked; a crew with no vendor record gets a
  neutral hint. `GET /api/jobs/[id]/labor-contracts` and `GET /api/crews`
  return `vendorCompliance`.
- Dashboard row "Subcontractors missing documents" (`vendor-compliance`,
  office roles): active subcontractors whose verdict is not `ok`. Company-wide
  — Mine and All show the same number.
- Calendar overlay kind `vendor_doc` ("General liability certificate expires —
  <vendor>") for the roles that keep the directory; never under a job filter;
  only the document in force.
- A task about a vendor carries `vendorId`; the task chip, sheet and emails
  name the vendor (`subjectLabel` kind `vendor`).

Not done in this stage: the record-payment and payment-request dialogs do not
repeat the callout (it sits on the card they open from), and
`LaborContract.contractorLicense` / `contractorInsurance` are untouched (they
print on contract PDFs).

### Operator

Cron wrapper `/home/knuco/crm-cron/vendor-compliance.sh`, crontab
`50 11 * * 1-5` (after the permit crons). A document that was never filed
raises no task; only dated documents do.

### Dev QA (2026-10-03)

API script 39/39 (missing ×3 → attention row count = list; add with a file,
download; bad date / type / order / file type 400; cron 403 without the
secret; one HIGH task for the Accounting default, due 14 days before expiry,
linked to the vendor; second run 0; a newer certificate closes it; a lapsed
document raises one URGENT task and a corrected date closes it; no task for a
missing W-9; expired replaces expiring; delete closes the task and removes the
file; owner setting; labor contract and crew carry the warning and the
contract still saves). Headless Chromium 23/23 at 1280 and 400 px (list pill,
owner control, add and edit dialogs, labor card callout, attention list, task
chip, dashboard row, calendar card), no console errors. SALES_REP: 403 on
every document and settings route, no dashboard row, no overlay. Dev DB
restored from a dump. Not exercised: the assignment email (dev's owner is a
muted seed user) and the oldest-admin fallback.

## Rules

- `JobExpense.vendor` is the payee as it arrived; `vendorId` is the match.
  Never rewrite the text to make a match.
- New vendor routes take `canManageVendors` / `canViewVendors`, never a bare
  session check.
- A vendor's compliance is derived from its documents on read and never
  stored; a gap warns and never blocks; an expiry alert is a task raised once
  per document date and closed by the record (`settleVendorAlerts`).
