-- A previous attempt of this migration partially created a now-renamed
-- "InspectionType" enum (the job-level Inspection model already owned
-- "InspectionResult"). Clean up the orphan if present, before recreating
-- the renamed permit-scoped enums below.
DROP TYPE IF EXISTS "InspectionType";

-- CreateEnum: permit-inspection types
CREATE TYPE "PermitInspectionType" AS ENUM (
  'ROUGH',
  'FRAMING',
  'ELECTRICAL',
  'PLUMBING',
  'MECHANICAL',
  'ROOFING_IN_PROGRESS',
  'ROOFING_FINAL',
  'FINAL',
  'OTHER'
);

-- CreateEnum: permit-inspection result
CREATE TYPE "PermitInspectionResult" AS ENUM (
  'SCHEDULED',
  'PASS',
  'FAIL',
  'CONDITIONAL',
  'CANCELLED'
);

-- CreateTable: job_permit_inspections
CREATE TABLE "job_permit_inspections" (
  "id"             TEXT                   NOT NULL,
  "permit_id"      TEXT                   NOT NULL,
  "type"           "PermitInspectionType" NOT NULL DEFAULT 'OTHER',
  "scheduled_for"  TIMESTAMP(3),
  "completed_at"   TIMESTAMP(3),
  "result"         "PermitInspectionResult" NOT NULL DEFAULT 'SCHEDULED',
  "inspector_name" TEXT,
  "notes"          TEXT,
  "created_at"     TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3)           NOT NULL,

  CONSTRAINT "job_permit_inspections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_permit_inspections_permit_id_idx"     ON "job_permit_inspections"("permit_id");
CREATE INDEX "job_permit_inspections_scheduled_for_idx" ON "job_permit_inspections"("scheduled_for");

ALTER TABLE "job_permit_inspections"
  ADD CONSTRAINT "job_permit_inspections_permit_id_fkey"
  FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Inspection-tagged FollowUpExecution rows so the processor can render
-- inspection.* template variables for INSPECTION_* events.
ALTER TABLE "follow_up_executions" ADD COLUMN "inspection_id" TEXT;

CREATE INDEX "follow_up_executions_inspection_id_idx"
  ON "follow_up_executions"("inspection_id");

ALTER TABLE "follow_up_executions"
  ADD CONSTRAINT "follow_up_executions_inspection_id_fkey"
  FOREIGN KEY ("inspection_id") REFERENCES "job_permit_inspections"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
