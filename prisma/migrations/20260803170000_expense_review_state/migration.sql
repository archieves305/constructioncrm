-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateIndex
CREATE INDEX "job_expenses_status_incurred_date_idx" ON "job_expenses"("status", "incurred_date");

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
