-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "budget_line_id" TEXT;

-- AlterTable
ALTER TABLE "labor_contracts" ADD COLUMN     "budget_line_id" TEXT;

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "category" TEXT,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_lines_job_id_idx" ON "budget_lines"("job_id");

-- AddForeignKey
ALTER TABLE "labor_contracts" ADD CONSTRAINT "labor_contracts_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_budget_line_id_fkey" FOREIGN KEY ("budget_line_id") REFERENCES "budget_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

