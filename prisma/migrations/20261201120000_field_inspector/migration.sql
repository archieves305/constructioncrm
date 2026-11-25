-- CreateEnum
CREATE TYPE "QualityInspectionKind" AS ENUM ('TRADE', 'INTERIOR', 'EXTERIOR', 'TURNOVER', 'MAINTENANCE', 'COMPLETION', 'PROGRESS', 'PRE_CONCEALMENT', 'WARRANTY', 'QUICK');

-- CreateEnum
CREATE TYPE "QualityInspectionStatus" AS ENUM ('OPEN', 'ACCEPTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QualityAnalysisStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "QualityFindingKind" AS ENUM ('OBSERVED', 'SUSPECTED', 'DOCUMENTATION', 'SCOPE', 'PHYSICAL_CHECK', 'CANNOT_DETERMINE');

-- CreateEnum
CREATE TYPE "QualitySeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'COSMETIC');

-- CreateEnum
CREATE TYPE "QualityReview" AS ENUM ('PROPOSED', 'CONFIRMED', 'DISMISSED');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "quality_inspection_id" TEXT;

-- AlterTable
ALTER TABLE "field_issues" ADD COLUMN     "quality_finding_id" TEXT;

-- CreateTable
CREATE TABLE "quality_inspections" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "QualityInspectionKind" NOT NULL,
    "status" "QualityInspectionStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT,
    "job_id" TEXT,
    "labor_contract_id" TEXT,
    "address_text" TEXT,
    "scope_text" TEXT,
    "quality_profile" TEXT NOT NULL DEFAULT 'standard',
    "started_by_user_id" TEXT NOT NULL,
    "accepted_by_user_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "accept_override" TEXT,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_areas" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "job_area_id" TEXT,
    "name" TEXT NOT NULL,
    "trade" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "verdict" TEXT,
    "summary" TEXT,
    "photos_needed" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_inspection_areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_photos" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "area_id" TEXT,
    "file_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'ORIGINAL',
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "quality" TEXT,
    "analysis_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_analyses" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "area_id" TEXT,
    "status" "QualityAnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "mode" TEXT NOT NULL DEFAULT 'standard',
    "not_before" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "ai_call_id" TEXT,
    "model" TEXT,
    "cost_usd" DOUBLE PRECISION,
    "duration_ms" INTEGER,
    "error" TEXT,
    "requested_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspection_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_findings" (
    "id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "area_id" TEXT,
    "photo_id" TEXT,
    "related_photo_ids" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'AI',
    "analysis_id" TEXT,
    "kind" "QualityFindingKind" NOT NULL,
    "trade" TEXT,
    "title" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "severity" "QualitySeverity" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "action" TEXT,
    "physical_check" TEXT,
    "boxes" JSONB NOT NULL DEFAULT '[]',
    "review" "QualityReview" NOT NULL DEFAULT 'PROPOSED',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "dismiss_reason" TEXT,
    "review_note" TEXT,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "ai_original" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_inspection_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_number_key" ON "quality_inspections"("number");

-- CreateIndex
CREATE INDEX "quality_inspections_job_id_idx" ON "quality_inspections"("job_id");

-- CreateIndex
CREATE INDEX "quality_inspections_status_created_at_idx" ON "quality_inspections"("status", "created_at");

-- CreateIndex
CREATE INDEX "quality_inspections_started_by_user_id_idx" ON "quality_inspections"("started_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_areas_inspection_id_name_key" ON "quality_inspection_areas"("inspection_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_photos_file_id_key" ON "quality_inspection_photos"("file_id");

-- CreateIndex
CREATE INDEX "quality_inspection_photos_inspection_id_area_id_idx" ON "quality_inspection_photos"("inspection_id", "area_id");

-- CreateIndex
CREATE INDEX "quality_inspection_analyses_status_not_before_idx" ON "quality_inspection_analyses"("status", "not_before");

-- CreateIndex
CREATE INDEX "quality_inspection_analyses_inspection_id_idx" ON "quality_inspection_analyses"("inspection_id");

-- CreateIndex
CREATE INDEX "quality_inspection_findings_inspection_id_review_idx" ON "quality_inspection_findings"("inspection_id", "review");

-- CreateIndex
CREATE INDEX "files_quality_inspection_id_idx" ON "files"("quality_inspection_id");

-- CreateIndex
CREATE UNIQUE INDEX "field_issues_quality_finding_id_key" ON "field_issues"("quality_finding_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_quality_inspection_id_fkey" FOREIGN KEY ("quality_inspection_id") REFERENCES "quality_inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_issues" ADD CONSTRAINT "field_issues_quality_finding_id_fkey" FOREIGN KEY ("quality_finding_id") REFERENCES "quality_inspection_findings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections" ADD CONSTRAINT "quality_inspections_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_areas" ADD CONSTRAINT "quality_inspection_areas_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_areas" ADD CONSTRAINT "quality_inspection_areas_job_area_id_fkey" FOREIGN KEY ("job_area_id") REFERENCES "job_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_photos" ADD CONSTRAINT "quality_inspection_photos_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_photos" ADD CONSTRAINT "quality_inspection_photos_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "quality_inspection_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_photos" ADD CONSTRAINT "quality_inspection_photos_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_photos" ADD CONSTRAINT "quality_inspection_photos_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "quality_inspection_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_analyses" ADD CONSTRAINT "quality_inspection_analyses_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_analyses" ADD CONSTRAINT "quality_inspection_analyses_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "quality_inspection_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_findings" ADD CONSTRAINT "quality_inspection_findings_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_findings" ADD CONSTRAINT "quality_inspection_findings_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "quality_inspection_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_findings" ADD CONSTRAINT "quality_inspection_findings_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "quality_inspection_photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_findings" ADD CONSTRAINT "quality_inspection_findings_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "quality_inspection_analyses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_findings" ADD CONSTRAINT "quality_inspection_findings_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- INS-00001… (hand-written; Prisma does not model sequences)
CREATE SEQUENCE IF NOT EXISTS "quality_inspection_number_seq" START 1;
