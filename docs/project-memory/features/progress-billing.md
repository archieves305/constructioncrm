# Feature — Progress billing (AIA G702/G703 payment applications)

_Stage 1 built and deployed 2026-08-27 (`891b891`, `78e3d6c`); JOB-00009 backfill ran the same day; every amount reproduced. **Stage 2 (change orders on PROGRESS jobs) deployed 2026-09-24 (`6b3868b`, migration `20260925120000_change_order_sov_lines`). Stage 3 (retainage release + Collections split) deployed 2026-09-24 (`4833ea3`, no migration). The feature is complete.**_

## Why

JOB-00009 (Towne Place Suites Clewiston, $832,500 drywall sub to a GC) is
billed monthly on AIA G702 applications with 10% retainage. The CRM only knew
"one invoice = one amount, default the whole balance", so the twelve imported
applications were bare amounts with the period and retainage in `notes`, and
`balanceDue` ($373,350.60) silently summed three different things: open A/R
($87,536.70) + retainage held ($60,742.90) + unbilled work ($225,071.00).

## Shape

- `Job.billingMethod` `LUMP_SUM | PROGRESS`, `Job.retainagePercent`.
  Switching to PROGRESS defaults retainage from the lead's property type —
  **10% commercial, 0% residential** — and seeds one `SovLine` for the whole
  contract (the "one line per contract" default Richard chose).
- `SovLine` — schedule of values (revenue side; **not** `BudgetLine`, which
  is cost side). Σ scheduled values should equal `contractAmount`; the UI
  warns when they drift (a change order does this — see Stage 2).
- An application is an `Invoice` with `applicationNumber`, `periodFrom/To`,
  a `retainagePercent` snapshot, and `InvoiceLine`s holding **this period's
  work only**. Everything cumulative is replayed from earlier applications in
  `getBillingSummary`, so the maths is exactly the form's:
  `due = (completed to date × (1 − r)) − previous certificates`.
- `Invoice.amount` stores the current payment due, so payments, A/R aging,
  `syncInvoiceStatus` and `recomputeJobBalance` are untouched.

## Rules enforced by the service

- Only the **latest** application can be edited (DRAFT only) or voided —
  earlier ones are already the "previous" of the ones after them.
- One draft at a time; no billing past a line's scheduled value; no
  negative payment due.
- Drafts never count as "previous"; VOID applications are skipped.
- A lump-sum "balance due" invoice is refused on a PROGRESS job.
- Create/edit needs ADMIN, MANAGER or OFFICE_STAFF (explicit list, not
  `hasMinRole`).

## Files

| File | Role |
|---|---|
| `src/lib/billing/g702.ts` | Pure arithmetic, shared with the browser preview |
| `src/lib/services/progress-billing.ts` | Read model, create/update, guards, SOV seeding |
| `src/app/api/jobs/[id]/billing` · `applications` · `sov`, `src/app/api/sov/[id]` | Routes |
| `src/app/api/invoices/[id]/route.ts` | Application guards on PATCH (amount, void, lines) |
| `src/app/api/jobs/[id]/route.ts` | `billingMethod` / `retainagePercent` |
| `src/components/jobs/invoices-panel.tsx` | Settings, G702 totals, SOV table, application dialog |
| `src/lib/pdf/invoice.tsx` | G702 summary + G703 continuation sheet |
| `prisma/migrations/20260827120000_progress_billing` | Schema |
| `scripts/backfill-clewiston-applications.ts` | JOB-00009 conversion (verifies every amount reproduces before committing) |

## Backfill (prod, once)

`scripts/backfill-clewiston-applications.ts` — sets PROGRESS/10%, one SOV
line, and turns apps 1–12 into real applications (gross = amount ÷ 0.9;
every one reproduces exactly — proven in `progress-billing.test.ts`). It
rolls back if any amount fails to reproduce. **Apps 13–14 are to be entered
through the UI**, not imported.

## Stage 2 — change orders on PROGRESS jobs (deployed `6b3868b`)

On a progress-billed job an approved change order is **not** invoiced on
its own. `applyDecision` (`lib/services/change-orders.ts`) branches on
`job.billingMethod`: PROGRESS → one new `SovLine` (`changeOrderId` set,
migration `20260925120000_change_order_sov_lines`) built by the pure,
tested `changeOrderSovLine` in `lib/billing/sov.ts` — next item number and
sort position, description `CO-n: title`, scheduled value = customer price
— and the work is billed on the following payment applications as it is
completed, which is how G702/G703 treats change orders (net change by
change orders sits in the contract sum; G703 carries the added items).
LUMP_SUM keeps issuing the invoice it always did. Fixed-price contracts
still `increment` on approval, so Σ SOV keeps matching the contract sum;
cost-plus / owned-rehab contracts still come from the labour rollup, so
the SOV drift warning can appear there — expected. No `invoice.sent`
follow-up task is raised for an SOV approval; the change-order follow-up
still closes. `DecisionResult` carries `billing: "INVOICE" | "SOV"` and
`sovItemNo`.

**The line's value follows the change order.** `PATCH /api/sov/[id]`
refuses `scheduledValue` on a linked line (400; description stays
editable) and `DELETE` refuses outright (409 — delete the change order).
`deleteChangeOrder` removes the line instead of an invoice and refuses
with `has_billing` (409, names the item and the amount) once a live
application has billed work on it; void that application first. VOID
applications' `InvoiceLine` rows on the line are dropped in the same
transaction — the FK is `Restrict`, and QA on dev caught the 500 that
skipping this produced.

**Read model / UI.** `getBillingSummary().sovLines[].changeOrderNumber`;
the Invoices tab badges the line `CO-n`, keeps its value read-only and
hides Remove. The change-orders list route includes `sovLine {id,
itemNo}`; rows and the detail dialog say "SOV item #n — bill on the next
application" where they used to say the invoice number; the decision
dialog explains the path and its button reads "Approve & add to SOV";
the delete confirm names the line. `ChangeOrdersPanel` takes
`billingMethod`.

Prod state when this shipped: JOB-00009 is the only PROGRESS job and had
no change orders, so nothing needed backfilling. Deductive change orders
are still impossible (`customerPrice` must be positive at create).

Tests: `lib/billing/sov.test.ts`, `lib/services/change-orders.test.ts`
(approve on each method, delete unwind, `has_billing` refusal).

## Stage 3 — retainage release + Collections (deployed `4833ea3`)

**A release is an application at a lower rate.** No new table, no flag:
`computeApplication` takes `previousRetainagePercent` (the rate the last
issued application withheld at) and reports `previousRetainage` and
`retainageReleased = max(0, previousRetainage − retainage)`. An
application at 0% with no work has current due = the retainage held,
because "earned less retainage" rises while "previous certificates"
stays; 5% releases half; a lower rate plus new work bills the work net
of the new rate and hands back the difference on the old work. After
JOB-00009's twelve applications a full release is exactly **$60,742.90**
and a half release $30,371.45 (`progress-billing.test.ts`).

**Effective vs nominal rate.** `getBillingSummary` returns
`retainagePercent` (the contract's nominal rate, `Job.retainagePercent`,
unchanged by releases), `effectiveRetainagePercent` (what the latest
issued application withheld at — the default for the next one),
`retainageReleasedOn` (the application that last lowered it) and
`totals.retainageReleased`. Drafts and VOIDs never move the effective
rate, so voiding a release reverts it naturally. Per-application
`retainagePercent` snapshots were already stored (Stage 1), which is why
this needed no migration.

**Writes.** `ApplicationInput.retainagePercent` (defaults to the
effective rate) and `lines` may be empty. Guards, in order:
`exceeds_scheduled_value` → `negative_due` (raising the rate claws money
back) → `nothing_billed` (no work and nothing released) → and
`bad_retainage` for a rate outside 0–100. `updateApplication` accepts
`retainagePercent` alone and recomputes the draft from its own lines.
`POST …/applications` and `PATCH /api/invoices/[id]` pass the rate
through. The G702 PDF adds a "Retainage released on this application"
line under item 3 when > 0.

**Collections.** `getProgressPositions` (`lib/services/financials.ts`),
served as `progress` from `GET /api/reports/financials`, splits each
PROGRESS job's stored `balanceDue` into **open A/R + retainage held +
balance to finish** — they sum to `balanceDue` exactly, proven on dev
(15,000 + 0 + 190,885.80 = 205,885.80). Read model only;
`recomputeJobBalance` is untouched, per the pressure-test rule. The page
gets a "Progress-billed jobs" card (per job, with totals; rows open the
Invoices tab) and the Outstanding KPI says how much of it is retainage
and unbilled work.

**Invoices tab.** The application dialog has a "Retainage % on this
application" field with **Release half / Release all / Keep n%** (shown
while retainage is held), a live "Retainage released" row in the G702
preview, the button reads "Create release draft" / "Release retainage &
send" when nothing else is billed, rows show a "releases $X retainage"
chip, and the totals strip shows the effective rate and what has been
released. The Retainage % setting in the header stays the nominal rate.

## Later

Nothing scheduled. If the GC ever reduces retainage by a dollar amount
rather than a rate, express it as a rate on the dialog (amount ÷
completed to date); a dedicated amount field would be a small addition
to `validateLines`.
