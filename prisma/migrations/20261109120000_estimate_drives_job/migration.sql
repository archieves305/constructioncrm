-- Stage B of the 2026-10-19 audit roadmap: the estimate drives the job.
-- All additive (nullable columns, SET NULL foreign keys); no backfill.

-- AlterTable
ALTER TABLE "budget_lines" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "change_orders" ADD COLUMN     "material_cost" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "estimated_cost_snapshot" DECIMAL(12,2),
ADD COLUMN     "source_estimate_id" TEXT,
ADD COLUMN     "source_roof_estimate_id" TEXT;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_estimate_id_fkey" FOREIGN KEY ("source_estimate_id") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_roof_estimate_id_fkey" FOREIGN KEY ("source_roof_estimate_id") REFERENCES "roof_estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

