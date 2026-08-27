# Feature — Progress billing (AIA G702/G703 payment applications)

_Built and deployed 2026-08-27 (`891b891`, `78e3d6c`). Stage 1 of 3. JOB-00009 backfill ran the same day; every amount reproduced._

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

## Later stages

- **Stage 2 — change orders on PROGRESS jobs.** Approval today issues a
  full-price invoice immediately (`change-orders.ts` ~L420). On a progress
  job it should add an SOV line instead and be billed as work completes.
- **Stage 3 — retainage release** as a final application; balance-to-finish
  on Collections.
