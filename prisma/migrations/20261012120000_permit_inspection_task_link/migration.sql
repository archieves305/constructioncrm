-- AlterTable
ALTER TABLE "job_permit_inspections" ADD COLUMN     "task_id" TEXT;

-- CreateIndex
CREATE INDEX "job_permit_inspections_task_id_idx" ON "job_permit_inspections"("task_id");

-- AddForeignKey
ALTER TABLE "job_permit_inspections" ADD CONSTRAINT "job_permit_inspections_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
