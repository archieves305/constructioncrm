-- An ANALYZE_TAKEOFF job hangs on its takeoff. The calls it makes are recorded
-- in ai_calls (subject_type 'takeoff'), the shared AI layer's table.

-- AlterTable
ALTER TABLE "plan_jobs" ADD COLUMN     "takeoff_id" TEXT;

-- CreateIndex
CREATE INDEX "plan_jobs_takeoff_id_idx" ON "plan_jobs"("takeoff_id");

-- AddForeignKey
ALTER TABLE "plan_jobs" ADD CONSTRAINT "plan_jobs_takeoff_id_fkey" FOREIGN KEY ("takeoff_id") REFERENCES "takeoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
