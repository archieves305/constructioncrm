-- AlterTable
ALTER TABLE "daily_labor_entries" ADD COLUMN     "payroll_payment_id" TEXT;

-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "payroll_payment_id" TEXT;

-- CreateTable
CREATE TABLE "payroll_payments" (
    "id" TEXT NOT NULL,
    "personnel_id" TEXT NOT NULL,
    "week_start" DATE NOT NULL,
    "regular_hours" DECIMAL(6,2) NOT NULL,
    "ot_hours" DECIMAL(6,2) NOT NULL,
    "gross_amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by_user_id" TEXT NOT NULL,

    CONSTRAINT "payroll_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_payments_week_start_idx" ON "payroll_payments"("week_start");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_payments_personnel_id_week_start_key" ON "payroll_payments"("personnel_id", "week_start");

-- CreateIndex
CREATE INDEX "daily_labor_entries_payroll_payment_id_idx" ON "daily_labor_entries"("payroll_payment_id");

-- CreateIndex
CREATE INDEX "job_expenses_payroll_payment_id_idx" ON "job_expenses"("payroll_payment_id");

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_payroll_payment_id_fkey" FOREIGN KEY ("payroll_payment_id") REFERENCES "payroll_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_labor_entries" ADD CONSTRAINT "daily_labor_entries_payroll_payment_id_fkey" FOREIGN KEY ("payroll_payment_id") REFERENCES "payroll_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_paid_by_user_id_fkey" FOREIGN KEY ("paid_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

