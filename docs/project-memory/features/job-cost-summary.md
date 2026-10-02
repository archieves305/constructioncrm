# Job cost summary (audit initiative 2, 2026-10-02)

One calculation of a job's cost position, read by the job's Money tab, the
Overview tab and Collections.

## The figures

`src/lib/jobs/cost-summary.ts` — pure `computeCostSummary`:

- **Original contract** — `Job.originalContractAmount` (set when a customer
  contract is signed, cleared when it is voided); on a fixed-price job with
  none stored it is derived as revised − approved change orders − approved
  billable add-ons. Null on rollup job types.
- **Approved change orders**, **billable add-ons**, **revised contract**
  (`Job.contractAmount`).
- **Estimated cost** — Σ budget lines; with no budget, the cost behind the
  signed estimate (`Estimate.subtotalCost` via the signed contract); else
  none.
- **Spent** — labor payments + unposted field labor + approved expenses.
- **Committed** — spent + labor contracts not yet paid. This equals the
  "cost" Collections has always shown (`getFinancialSummary`). Richard's
  ruling 2026-10-02: crew labor counts when the labor contract is signed;
  the unpaid part is shown as committed.
- **Projected cost** — the estimate, or the commitments once they pass it
  (`overBudget`). **Remaining** = projected − spent.
- **Projected profit / margin** — revised contract − projected cost. Null
  when there is neither an estimate nor any cost (no "100% margin").
- **Billed to date** (invoices SENT / PAID), **collected**, **over / under
  billed** = billed − revised × (committed ÷ projected cost); null with no
  estimate.

## Shape

- `src/lib/services/job-cost.ts` — `getJobCostRows(where)` (9 grouped
  queries for any set of jobs) and `getJobCostSummary(jobId)`.
- `GET /api/jobs/[id]/cost-summary` (`guardJob` read);
  `GET /api/reports/financials` adds `jobCosts`.
- `components/jobs/cost-summary-card.tsx` — on the job's Money tab, under
  the sub-tabs; `useJobCostSummary` (key `["job", id, "cost-summary"]`).
- The **Budget** sub-tab now shows on every job type; on non-rehab jobs its
  "cost" is the summary's committed figure.
- Overview: estimated cost, projected profit and an "over the estimated
  cost" attention row.
- Collections: "Job costs and projected profit" replaces the profitability
  table (open billable jobs, lowest projected margin first).
- Migration `20261010120000_job_original_contract` (+ backfill from signed
  contracts whose money was applied).

## Rules

- Any new screen that shows a job's cost or profit reads `getJobCostRows` /
  `getJobCostSummary`. Do not sum expenses or labor anywhere else.
- Only reviewed money counts: APPROVED expenses, RECEIVED payments, issued
  invoices, APPROVED change orders.

## Not yet

Materials and non-crew commitments (initiative 6: vendors and commitments
feed `committed`); seeding budget lines from an estimate; automatic
allocation of expenses to budget lines.
