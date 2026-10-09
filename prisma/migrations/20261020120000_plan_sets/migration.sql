-- CreateEnum
CREATE TYPE "PlanDocumentKind" AS ENUM ('FULL_SET', 'PARTIAL', 'ADDENDUM', 'REVISION');

-- CreateEnum
CREATE TYPE "PlanDocumentStatus" AS ENUM ('UPLOADED', 'INDEXING', 'INDEXED', 'FAILED');

-- CreateEnum
CREATE TYPE "PlanDiscipline" AS ENUM ('ARCHITECTURAL', 'STRUCTURAL', 'CIVIL', 'PLUMBING', 'MECHANICAL', 'ELECTRICAL', 'GAS', 'LANDSCAPE', 'LOW_VOLTAGE', 'IRRIGATION', 'GENERAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SheetScaleSource" AS ENUM ('NONE', 'AUTO', 'AUTO_VERIFIED', 'MANUAL');

-- CreateEnum
CREATE TYPE "PlanJobKind" AS ENUM ('INDEX_DOCUMENT', 'ANALYZE_TAKEOFF');

-- CreateEnum
CREATE TYPE "PlanJobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanJobStepStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED', 'SKIPPED');

-- AlterEnum
ALTER TYPE "FileCategory" ADD VALUE 'PLAN_SET';

-- CreateTable
CREATE TABLE "plan_sets" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "job_id" TEXT,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_documents" (
    "id" TEXT NOT NULL,
    "plan_set_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "kind" "PlanDocumentKind" NOT NULL DEFAULT 'FULL_SET',
    "label" TEXT NOT NULL,
    "revision_label" TEXT,
    "sequence" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "page_count" INTEGER,
    "status" "PlanDocumentStatus" NOT NULL DEFAULT 'UPLOADED',
    "error" TEXT,
    "indexed_at" TIMESTAMP(3),
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_sheets" (
    "id" TEXT NOT NULL,
    "plan_document_id" TEXT NOT NULL,
    "page_number" INTEGER NOT NULL,
    "width_pt" DOUBLE PRECISION NOT NULL,
    "height_pt" DOUBLE PRECISION NOT NULL,
    "rotation" INTEGER NOT NULL DEFAULT 0,
    "sheet_number" TEXT,
    "title" TEXT,
    "discipline" "PlanDiscipline" NOT NULL DEFAULT 'UNKNOWN',
    "revision_label" TEXT,
    "scale_text" TEXT,
    "detected" JSONB,
    "index_confidence" DOUBLE PRECISION,
    "index_corrected_by_user_id" TEXT,
    "is_raster" BOOLEAN NOT NULL DEFAULT false,
    "text_item_count" INTEGER NOT NULL DEFAULT 0,
    "segment_count" INTEGER NOT NULL DEFAULT 0,
    "text_key" TEXT,
    "geometry_key" TEXT,
    "render_key_72" TEXT,
    "render_key_144" TEXT,
    "scale_source" "SheetScaleSource" NOT NULL DEFAULT 'NONE',
    "pt_per_ft" DOUBLE PRECISION,
    "scale_confidence" DOUBLE PRECISION,
    "scale_verification" JSONB,
    "calibrated_by_user_id" TEXT,
    "calibrated_at" TIMESTAMP(3),
    "superseded_by_sheet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_jobs" (
    "id" TEXT NOT NULL,
    "kind" "PlanJobKind" NOT NULL,
    "plan_document_id" TEXT,
    "status" "PlanJobStatus" NOT NULL DEFAULT 'PENDING',
    "total_steps" INTEGER NOT NULL DEFAULT 0,
    "done_steps" INTEGER NOT NULL DEFAULT 0,
    "failed_steps" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "requested_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_job_steps" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "step_key" TEXT NOT NULL,
    "depends_on" TEXT[],
    "status" "PlanJobStepStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_at" TIMESTAMP(3),
    "lock_token" TEXT,
    "error" TEXT,
    "result" JSONB,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "plan_job_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_sets_lead_id_idx" ON "plan_sets"("lead_id");

-- CreateIndex
CREATE INDEX "plan_sets_job_id_idx" ON "plan_sets"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_documents_file_id_key" ON "plan_documents"("file_id");

-- CreateIndex
CREATE INDEX "plan_documents_sha256_idx" ON "plan_documents"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "plan_documents_plan_set_id_sequence_key" ON "plan_documents"("plan_set_id", "sequence");

-- CreateIndex
CREATE INDEX "plan_sheets_sheet_number_idx" ON "plan_sheets"("sheet_number");

-- CreateIndex
CREATE UNIQUE INDEX "plan_sheets_plan_document_id_page_number_key" ON "plan_sheets"("plan_document_id", "page_number");

-- CreateIndex
CREATE INDEX "plan_jobs_status_idx" ON "plan_jobs"("status");

-- CreateIndex
CREATE INDEX "plan_jobs_plan_document_id_idx" ON "plan_jobs"("plan_document_id");

-- CreateIndex
CREATE INDEX "plan_job_steps_job_id_status_idx" ON "plan_job_steps"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "plan_job_steps_job_id_step_key_key" ON "plan_job_steps"("job_id", "step_key");

-- AddForeignKey
ALTER TABLE "plan_sets" ADD CONSTRAINT "plan_sets_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sets" ADD CONSTRAINT "plan_sets_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sets" ADD CONSTRAINT "plan_sets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_documents" ADD CONSTRAINT "plan_documents_plan_set_id_fkey" FOREIGN KEY ("plan_set_id") REFERENCES "plan_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_documents" ADD CONSTRAINT "plan_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_documents" ADD CONSTRAINT "plan_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sheets" ADD CONSTRAINT "plan_sheets_plan_document_id_fkey" FOREIGN KEY ("plan_document_id") REFERENCES "plan_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sheets" ADD CONSTRAINT "plan_sheets_index_corrected_by_user_id_fkey" FOREIGN KEY ("index_corrected_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sheets" ADD CONSTRAINT "plan_sheets_superseded_by_sheet_id_fkey" FOREIGN KEY ("superseded_by_sheet_id") REFERENCES "plan_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_jobs" ADD CONSTRAINT "plan_jobs_plan_document_id_fkey" FOREIGN KEY ("plan_document_id") REFERENCES "plan_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_jobs" ADD CONSTRAINT "plan_jobs_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_job_steps" ADD CONSTRAINT "plan_job_steps_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "plan_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

