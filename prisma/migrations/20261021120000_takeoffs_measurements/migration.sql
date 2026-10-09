-- CreateEnum
CREATE TYPE "TakeoffTrade" AS ENUM ('ROOFING', 'PLUMBING');

-- CreateEnum
CREATE TYPE "TakeoffStatus" AS ENUM ('DRAFT', 'ANALYZING', 'IN_REVIEW', 'READY', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "MeasurementKind" AS ENUM ('AREA', 'LENGTH', 'COUNT');

-- CreateEnum
CREATE TYPE "MeasurementOrigin" AS ENUM ('AI', 'MANUAL', 'TEXT_LABEL', 'SCHEDULE');

-- CreateEnum
CREATE TYPE "TakeoffReviewStatus" AS ENUM ('AI_GENERATED', 'REVIEWED', 'MODIFIED', 'APPROVED', 'EXCLUDED', 'NEEDS_CLARIFICATION');

-- CreateEnum
CREATE TYPE "TakeoffConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "takeoffs" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "job_id" TEXT,
    "plan_set_id" TEXT NOT NULL,
    "trade" "TakeoffTrade" NOT NULL,
    "status" "TakeoffStatus" NOT NULL DEFAULT 'DRAFT',
    "pinned_document_ids" JSONB NOT NULL,
    "specs" JSONB,
    "specs_review_status" "TakeoffReviewStatus",
    "settings" JSONB,
    "created_by_user_id" TEXT NOT NULL,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takeoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takeoff_sheets" (
    "takeoff_id" TEXT NOT NULL,
    "plan_sheet_id" TEXT NOT NULL,
    "selected_by" TEXT NOT NULL,
    "role" TEXT,

    CONSTRAINT "takeoff_sheets_pkey" PRIMARY KEY ("takeoff_id","plan_sheet_id")
);

-- CreateTable
CREATE TABLE "takeoff_measurements" (
    "id" TEXT NOT NULL,
    "takeoff_id" TEXT NOT NULL,
    "plan_sheet_id" TEXT NOT NULL,
    "kind" "MeasurementKind" NOT NULL,
    "metric_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "attributes" JSONB,
    "geometry" JSONB NOT NULL,
    "pt_per_ft" DOUBLE PRECISION,
    "value_raw" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "previous_value" DOUBLE PRECISION,
    "origin" "MeasurementOrigin" NOT NULL,
    "confidence" "TakeoffConfidence" NOT NULL,
    "confidence_score" DOUBLE PRECISION,
    "review_status" "TakeoffReviewStatus" NOT NULL DEFAULT 'AI_GENERATED',
    "evidence" JSONB,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "takeoff_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "takeoffs_number_key" ON "takeoffs"("number");

-- CreateIndex
CREATE INDEX "takeoffs_lead_id_idx" ON "takeoffs"("lead_id");

-- CreateIndex
CREATE INDEX "takeoffs_plan_set_id_idx" ON "takeoffs"("plan_set_id");

-- CreateIndex
CREATE INDEX "takeoff_measurements_takeoff_id_idx" ON "takeoff_measurements"("takeoff_id");

-- CreateIndex
CREATE INDEX "takeoff_measurements_plan_sheet_id_idx" ON "takeoff_measurements"("plan_sheet_id");

-- AddForeignKey
ALTER TABLE "plan_sheets" ADD CONSTRAINT "plan_sheets_calibrated_by_user_id_fkey" FOREIGN KEY ("calibrated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoffs" ADD CONSTRAINT "takeoffs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoffs" ADD CONSTRAINT "takeoffs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoffs" ADD CONSTRAINT "takeoffs_plan_set_id_fkey" FOREIGN KEY ("plan_set_id") REFERENCES "plan_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoffs" ADD CONSTRAINT "takeoffs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_sheets" ADD CONSTRAINT "takeoff_sheets_takeoff_id_fkey" FOREIGN KEY ("takeoff_id") REFERENCES "takeoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_sheets" ADD CONSTRAINT "takeoff_sheets_plan_sheet_id_fkey" FOREIGN KEY ("plan_sheet_id") REFERENCES "plan_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_takeoff_id_fkey" FOREIGN KEY ("takeoff_id") REFERENCES "takeoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_plan_sheet_id_fkey" FOREIGN KEY ("plan_sheet_id") REFERENCES "plan_sheets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express these): a takeoff number that is never
-- reused, and the invariants a measurement must hold.
CREATE SEQUENCE IF NOT EXISTS takeoff_number_seq START 1;
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_value_chk" CHECK ("value_raw" >= 0);
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_unit_chk" CHECK ("unit" IN ('LF', 'SF', 'EA'));
ALTER TABLE "takeoff_measurements" ADD CONSTRAINT "takeoff_measurements_scale_chk" CHECK ("kind" = 'COUNT' OR "pt_per_ft" IS NOT NULL);
