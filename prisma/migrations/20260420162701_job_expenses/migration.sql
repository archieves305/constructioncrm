-- CreateEnum
CREATE TYPE "JobExpenseType" AS ENUM ('MATERIAL', 'LABOR', 'EQUIPMENT', 'PERMIT_FEE', 'SUBCONTRACTOR', 'CHANGE_ORDER', 'OTHER');

-- CreateTable
CREATE TABLE "job_expenses" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "type" "JobExpenseType" NOT NULL DEFAULT 'OTHER',
    "vendor" TEXT,
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "incurred_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_expenses_job_id_idx" ON "job_expenses"("job_id");

-- CreateIndex
CREATE INDEX "job_expenses_type_idx" ON "job_expenses"("type");

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
