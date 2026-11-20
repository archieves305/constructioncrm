# Our own projects: flips and rentals

Plan approved 2026-11-20 (`~/.claude/plans/i-need-to-adjust-flickering-treehouse.md`).

## Why

Every job used one stage list and one Core workflow, both built for client
work. An owned project (`jobType OWNED_REHAB`) could only start as a lead
marked Won and then be switched. So it started with:

- a 50 % deposit,
- "Deposit Needed" and "Collect deposit",
- deposit, final-invoice and final-payment steps it could never satisfy.

It was also counted in Collections' totals and the deposits-missing row, and
the board showed its cost as if it were a contract price.

## Rulings (Richard, 2026-11-20)

- Each kind has its own stage list.
- Owned projects start from a **New project** button.
- Track:
  - budget vs spend by category,
  - purchase price and all-in cost,
  - ARV and sale price for a flip,
  - rent for a rental.
- The Jobs board and list get a **Client jobs | Our projects** toggle.

## Stage 1 — deployed 2026-11-20 as `95f3aba`

### Kinds and stages

- **Kinds:** `JobKind` = CLIENT | FLIP | RENTAL, derived on read by `jobKindOf` in `src/lib/jobs/stage-kinds.ts`.
  - CLIENT is any job that is not OWNED_REHAB.
  - FLIP and RENTAL come from `Job.ownedPurpose`; an owned job with no purpose reads as a flip.
- **Stages:** each `JobStage.kinds` lists the kinds that use it. `STAGE_SEED` is the source, mirrored in the migration's INSERT.
  - Client: today's 15 stages.
  - Flip and rental share: Planning → Scope Finalized → permit stages → Materials Ordered → Scheduled → In Progress → Punch List → Final Inspection.
  - Flip ends: Listed → Under Contract → Sold (closed).
  - Rental ends: Ready to Rent → Leased (closed).
  - Closed serves every kind and moved to order 20.
- **Stage rules:**
  - `changeJobStage` refuses a stage outside the job's kind (`JobStageKindError` → 400; bulk moves count it as refused).
  - The review-request mail goes to client jobs only.
  - The next action comes from `NEXT_ACTION`.
- **Stage sync:** `stageNameForWorkflow(steps, kind)`.
  - On an owned job, `close_job` lands on Listed / Ready to Rent.
  - Never "Final Payment Due" or "Financing Cleared".

### Workflow

- **Core generation 3** (`prisma/seeds/workflows/v3/core.ts`, hash pinned): generation 2 plus the toggle `customer_job`.
  - With the toggle off, these steps are left out: `review_contract`, `verify_deposit`, `submit_final_invoice`, `confirm_final_payment`.
  - The customer's checklist lines are left out too.
  - The trades stay on generation 2; the keys are the same, so they fit.
- **The toggle is never a choice:** `togglesForSubject` in `subject.ts` forces it from the job type in apply, preview and every reconcile, and `read.ts` hides it from the scope editor.

### Creating and converting

- **New project:** `POST /api/jobs/owned` (money roles) calls `createOwnedProject` in `src/lib/jobs/owned-project.ts`.
  - It creates an `INTERNAL` lead in the Won lead stage. `LeadKind.INTERNAL` keeps it off every customer list, nurture, the funnel and the review mail; its lead stage route answers 409.
  - The job is OWNED_REHAB with a purpose, no deposit, the Planning stage and budget lines.
  - The project manager defaults to whoever starts it.
  - The Core workflow is applied with the customer steps left out.
- **Converting:** changing the kind on Pricing (Fixed price / Cost-plus / Our flip / Our rental) runs `changeJobKind` from the job PATCH. It:
  - maps the stage (`mapStageToKind`),
  - clears the deposit,
  - reconciles the workflow,
  - stands down open customer steps on a generation-2 Core,
  - writes an audit row.

### Lists and money

- **Lists:** `/api/jobs?view=CLIENT|OWNED|FLIP|RENTAL` (`buildJobListWhere`). `withCost=true` adds `ownedCost` (budget, spent, committed, variance) from the shared cost calculation, for `canViewCompanyFinancials` roles.
- **Jobs page** (`?kind=owned`):
  - the board has its own columns, the cards show budget / spent / under–over, and drops into the other kind's stages are refused;
  - the owned list shows Budget / Spent / Under–over instead of Contract / Deposit / Balance (CSV too);
  - each stage pill shows only that job's own stages.
- **Fences:** owned jobs are out of Collections (totals, deposits missing), out of the `getFinancialSummary` totals, and out of the `deposits-missing` attention row.
- **Money fields:** `ownedPurpose`, `purchasePrice`, `afterRepairValue`, `salePrice`, `saleDate`, `monthlyRent` are money fields (money roles to write; full money view to read).

### Migration and backfill

- **Migration** `20261127120000_owned_projects` is additive:
  - enums, `job_stages.kinds`, the six job columns, `LeadKind.INTERNAL`;
  - the stage rows (INSERT … ON CONFLICT (name));
  - existing owned jobs get a purpose (RENTAL if `is_rental_turnover`, else FLIP).
- **Backfill:** `scripts/owned-projects-2026-11.ts` (dry run by default; `--yes`). For each owned job it clears the deposit, moves it off client-only stages, and stands down open customer steps. It is idempotent.

### Gate and dev QA

- **Gate:** typecheck clean, lint 5/21 (nothing in the touched files), 2231 tests, build clean.
- **Dev QA:**
  - API 26/26: create flip, Planning, no deposit, no customer steps, stage refusals 400, Listed, lists, internal lead fenced, client → rental conversion.
  - Headless Chromium 24/24 at 1440 / 400 px.
  - SALES_REP: 403 on New project.
  - Backfill dry run / `--yes` / re-run 0 on a staged job.
  - Dev DB restored after; Core v3 is seeded on dev.

### Not exercised

- `close_job` → Listed end to end in the app (unit-tested only).

## Stage 2 — built + dev-QA'd 2026-11-20 on `owned-projects`, not committed

No migration.

### Calculations

- `computeCostSummary.budgetVariance` = estimated cost (the budget) − committed: + under, − over, null with no budget.
- Pure `lib/jobs/owned-returns.ts`:
  - all-in = purchase price + projected cost;
  - invested so far = purchase price + committed;
  - a flip's expected profit = ARV − all-in (margin of ARV), and once sold, sale price − all-in;
  - a rental's gross yield = rent × 12 ÷ all-in.
  - A figure missing an input is null.
- `getJobCostRows` carries `owned` (the returns) for owned jobs. `/api/jobs/[id]/cost-summary` returns `{ ...summary, owned }` (`getJobCostSummaryWithReturns`).

### One cost basis

- The owned header cards and BudgetPanel read the cost summary's `committed`, never `contractAmount`. The job page's own budget query is gone.
- BudgetPanel's "Spent (job cost)" now reads "Spent + committed".

### Owned job page

- Header cards: Budget · Spent + committed · Under / Over budget · Expected profit, or Profit on the sale (a flip) / Gross yield (a rental).
- `OwnedPropertyCard` replaces the customer and financing cards. It shows the address, purchase, ARV, sale price and date, and rent, and the money roles can edit them through the job PATCH.
- The Money tab opens on Budget (`moneyStep`). Payments, Invoices, Contract and Change orders are hidden.
- The "Budget and spend" card shows Under / Over budget, All-in cost, and Expected profit / Profit on the sale / Gross yield.

### Budget tab

- A "By category" table: budget, actual (allocations), committed, under / over; uncategorised lines go under "Other" (`lib/budget/by-category.ts`).

### Overview and dashboard

- Overview: an owned job reads "Budget" and shows how much is still free.
- Dashboard owner strip: an "Our projects" tile (`summariseOwnedProjects`) with spent + committed of budget, how many are over, and the flips' expected profit. It links to `/jobs?kind=owned`.

### Backfill script

- `scripts/owned-projects-2026-11.ts` now exits explicitly. On prod the `--yes` run finished its work but its process never exited, because of timers left by `updateTask`.

### Gate and dev QA

- **Gate:** typecheck clean, lint 5/21, 2240 tests (+9), build clean.
- **Dev QA:**
  - API 14/14: budget 60,000; a 70,000 expense → over by 10,000 and all-in 320,000; sale 400,000 → profit 80,000; negative purchase price 400; rental yield 12.5 %; owner strip counts.
  - Headless Chromium 22/22 at 1440 / 400 px; client jobs unchanged.
  - Dev DB restored.

## Deploy (done 2026-11-20)

BUILD_ID `SPc9aMTE-WvIH1XqCpHoI`. Core generation 3 seeded on prod. Backfill applied to JOB-00003, JOB-00014 and JOB-00022, all treated as flips.


1. `KNUCO_PUBLIC_URL=https://crm.careyos.com ./deploy.sh --yes` (carries the migration).
2. Workflow seed: dry run, then the real run (Core generation 3 created, v2 superseded).
3. `scripts/owned-projects-2026-11.ts`: dry run, then `--yes` on Richard's word.
