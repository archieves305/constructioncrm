-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "daily_log_id" TEXT,
ADD COLUMN     "estimate_id" TEXT,
ADD COLUMN     "invoice_id" TEXT,
ADD COLUMN     "prospect_id" TEXT;

-- CreateIndex
CREATE INDEX "tasks_lead_id_idx" ON "tasks"("lead_id");

-- CreateIndex
CREATE INDEX "tasks_job_id_idx" ON "tasks"("job_id");

-- CreateIndex
CREATE INDEX "tasks_estimate_id_idx" ON "tasks"("estimate_id");

-- CreateIndex
CREATE INDEX "tasks_invoice_id_idx" ON "tasks"("invoice_id");

-- CreateIndex
CREATE INDEX "tasks_prospect_id_idx" ON "tasks"("prospect_id");

-- CreateIndex
CREATE INDEX "tasks_daily_log_id_idx" ON "tasks"("daily_log_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_daily_log_id_fkey" FOREIGN KEY ("daily_log_id") REFERENCES "daily_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: tasks spawned from field issues inherit the issue's daily log, so
-- they surface on the office daily-log page without a second lookup.
UPDATE "tasks" t
SET "daily_log_id" = fi."daily_log_id"
FROM "field_issues" fi
WHERE fi."task_id" = t."id"
  AND fi."daily_log_id" IS NOT NULL
  AND t."daily_log_id" IS NULL;
