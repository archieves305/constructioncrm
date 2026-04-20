-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "paid_from" TEXT,
ADD COLUMN     "paid_method" "PaymentMethod";
