# Vendors, subcontractor compliance, commitments (audit initiative 6)

Three stages, plan approved 2026-10-03
(`~/.claude/plans/encapsulated-frolicking-possum.md`). Stage 1 is built;
Stages 2 (compliance documents + expiry alerts) and 3 (commitments feeding
committed cost) follow, each with its own migration.

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

## Rules

- `JobExpense.vendor` is the payee as it arrived; `vendorId` is the match.
  Never rewrite the text to make a match.
- New vendor routes take `canManageVendors` / `canViewVendors`, never a bare
  session check.
