-- CreateTable
CREATE TABLE "budget_allocations" (
    "id" TEXT NOT NULL,
    "budget_line_id" TEXT NOT NULL,
    "expense_id" TEXT,
    "labor_contract_id" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_allocations_budget_line_id_idx" ON "budget_allocations"("budget_line_id");
CREATE INDEX "budget_allocations_expense_id_idx" ON "budget_allocations"("expense_id");
CREATE INDEX "budget_allocations_labor_contract_id_idx" ON "budget_allocations"("labor_contract_id");

-- AddForeignKey
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "job_expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budget_allocations" ADD CONSTRAINT "budget_allocations_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill existing single-line links as full-amount allocations.
INSERT INTO "budget_allocations" ("id", "budget_line_id", "expense_id", "amount", "created_at")
SELECT gen_random_uuid()::text, e."budget_line_id", e."id", e."amount", CURRENT_TIMESTAMP
FROM "job_expenses" e
WHERE e."budget_line_id" IS NOT NULL;

INSERT INTO "budget_allocations" ("id", "budget_line_id", "labor_contract_id", "amount", "created_at")
SELECT gen_random_uuid()::text, lc."budget_line_id", lc."id",
       lc."contract_amount" + COALESCE(
         (SELECT SUM(co."amount") FROM "labor_change_orders" co WHERE co."labor_contract_id" = lc."id"),
         0),
       CURRENT_TIMESTAMP
FROM "labor_contracts" lc
WHERE lc."budget_line_id" IS NOT NULL;

-- Drop the old single-line FK columns (allocations are now the source of truth).
ALTER TABLE "job_expenses" DROP CONSTRAINT IF EXISTS "job_expenses_budget_line_id_fkey";
ALTER TABLE "job_expenses" DROP COLUMN "budget_line_id";

ALTER TABLE "labor_contracts" DROP CONSTRAINT IF EXISTS "labor_contracts_budget_line_id_fkey";
ALTER TABLE "labor_contracts" DROP COLUMN "budget_line_id";
