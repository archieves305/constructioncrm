-- CreateEnum
CREATE TYPE "ExpenseReconcileDecision" AS ENUM ('DUPLICATE', 'KEEP');

-- CreateTable
CREATE TABLE "expense_reconciliations" (
    "id" TEXT NOT NULL,
    "manual_expense_id" TEXT NOT NULL,
    "external_expense_id" TEXT NOT NULL,
    "decision" "ExpenseReconcileDecision" NOT NULL,
    "job_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "manual_vendor" TEXT,
    "external_vendor" TEXT,
    "manual_incurred_on" TIMESTAMP(3) NOT NULL,
    "external_incurred_on" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expense_reconciliations_job_id_idx" ON "expense_reconciliations"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_reconciliations_manual_expense_id_external_expense__key" ON "expense_reconciliations"("manual_expense_id", "external_expense_id");

-- AddForeignKey
ALTER TABLE "expense_reconciliations" ADD CONSTRAINT "expense_reconciliations_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

