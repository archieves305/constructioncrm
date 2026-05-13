-- AlterTable: expand job_permits
ALTER TABLE "job_permits"
  ADD COLUMN "expected_approval_date" TIMESTAMP(3),
  ADD COLUMN "expiration_date"        TIMESTAMP(3),
  ADD COLUMN "permit_fee"             DECIMAL(10,2),
  ADD COLUMN "inspector_name"         TEXT;

-- AlterTable: link follow_up_executions to a permit so permit-triggered
-- workflows can pass permit.* context through to templates and tasks.
ALTER TABLE "follow_up_executions" ADD COLUMN "permit_id" TEXT;

-- CreateIndex
CREATE INDEX "follow_up_executions_permit_id_idx" ON "follow_up_executions"("permit_id");

-- AddForeignKey
ALTER TABLE "follow_up_executions"
  ADD CONSTRAINT "follow_up_executions_permit_id_fkey"
  FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
