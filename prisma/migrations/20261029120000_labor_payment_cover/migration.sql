-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "covered_by_labor_payment_id" TEXT,
ADD COLUMN     "labor_cleared_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "job_expenses_covered_by_labor_payment_id_idx" ON "job_expenses"("covered_by_labor_payment_id");

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_covered_by_labor_payment_id_fkey" FOREIGN KEY ("covered_by_labor_payment_id") REFERENCES "labor_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

