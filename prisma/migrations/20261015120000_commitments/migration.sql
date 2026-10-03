-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "commitment_id" TEXT;

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "budget_line_id" TEXT,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'OPEN',
    "committed_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commitments_vendor_id_idx" ON "commitments"("vendor_id");

-- CreateIndex
CREATE INDEX "commitments_job_id_status_idx" ON "commitments"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commitments_job_id_number_key" ON "commitments"("job_id", "number");

-- CreateIndex
CREATE INDEX "job_expenses_commitment_id_idx" ON "job_expenses"("commitment_id");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

