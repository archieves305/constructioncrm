-- CreateEnum
CREATE TYPE "JurisdictionKind" AS ENUM ('CITY', 'TOWN', 'VILLAGE', 'COUNTY', 'STATE', 'OTHER');

-- CreateEnum
CREATE TYPE "SubmissionMethod" AS ENUM ('PORTAL', 'EMAIL', 'IN_PERSON', 'MAIL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "KnowledgeKind" AS ENUM ('REQUIREMENT', 'LESSON', 'TIP');

-- CreateEnum
CREATE TYPE "KnowledgeReliability" AS ENUM ('OFFICIAL', 'INTERNAL', 'OBSERVED');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PermitPartyRole" AS ENUM ('OWNER', 'APPLICANT', 'QUALIFIER', 'ARCHITECT', 'ENGINEER_OF_RECORD', 'SUBCONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "CycleOutcome" AS ENUM ('PENDING', 'APPROVED', 'CORRECTIONS', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "SubmissionKind" AS ENUM ('INITIAL', 'RESUBMISSION', 'REVISION');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PermitStatus" ADD VALUE 'PREPARING';
ALTER TYPE "PermitStatus" ADD VALUE 'CORRECTIONS';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "permit_id" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "permit_doc_type" TEXT,
ADD COLUMN     "permit_id" TEXT;

-- AlterTable
ALTER TABLE "job_permits" ADD COLUMN     "application_number" TEXT,
ADD COLUMN     "current_cycle" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "jurisdiction_id" TEXT,
ADD COLUMN     "permit_type_key" TEXT,
ADD COLUMN     "scope_description" TEXT,
ADD COLUMN     "valuation" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "JurisdictionKind" NOT NULL DEFAULT 'CITY',
    "county" TEXT,
    "state" TEXT NOT NULL DEFAULT 'FL',
    "hvhz" BOOLEAN NOT NULL DEFAULT false,
    "organization_id" TEXT,
    "portal_url" TEXT,
    "submission_method" "SubmissionMethod" NOT NULL DEFAULT 'UNKNOWN',
    "review_days_target" INTEGER,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_type_defs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permit_type_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_knowledge" (
    "id" TEXT NOT NULL,
    "kind" "KnowledgeKind" NOT NULL,
    "jurisdiction_id" TEXT,
    "permit_type_key" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "document_type" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "reliability" "KnowledgeReliability" NOT NULL DEFAULT 'INTERNAL',
    "source_url" TEXT,
    "effective_from" TIMESTAMP(3),
    "effective_to" TIMESTAMP(3),
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'APPROVED',
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_parties" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "role" "PermitPartyRole" NOT NULL,
    "organization_id" TEXT,
    "contact_id" TEXT,
    "vendor_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "license_number" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_review_cycles" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "outcome" "CycleOutcome" NOT NULL DEFAULT 'PENDING',
    "outcome_at" TIMESTAMP(3),
    "reviewer_name" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_review_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_submissions" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "kind" "SubmissionKind" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "method" "SubmissionMethod" NOT NULL,
    "confirmation_ref" TEXT,
    "notes" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "submitted_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permit_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_submission_files" (
    "submission_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,

    CONSTRAINT "permit_submission_files_pkey" PRIMARY KEY ("submission_id","file_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "jurisdictions_key_key" ON "jurisdictions"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permit_type_defs_key_key" ON "permit_type_defs"("key");

-- CreateIndex
CREATE INDEX "permit_knowledge_kind_status_jurisdiction_id_permit_type_ke_idx" ON "permit_knowledge"("kind", "status", "jurisdiction_id", "permit_type_key");

-- CreateIndex
CREATE INDEX "permit_parties_permit_id_idx" ON "permit_parties"("permit_id");

-- CreateIndex
CREATE UNIQUE INDEX "permit_review_cycles_permit_id_number_key" ON "permit_review_cycles"("permit_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "permit_submissions_cycle_id_key" ON "permit_submissions"("cycle_id");

-- CreateIndex
CREATE INDEX "permit_submissions_permit_id_idx" ON "permit_submissions"("permit_id");

-- CreateIndex
CREATE INDEX "permit_submission_files_file_id_idx" ON "permit_submission_files"("file_id");

-- CreateIndex
CREATE INDEX "tasks_permit_id_idx" ON "tasks"("permit_id");

-- CreateIndex
CREATE INDEX "files_permit_id_idx" ON "files"("permit_id");

-- CreateIndex
CREATE INDEX "job_permits_jurisdiction_id_idx" ON "job_permits"("jurisdiction_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_permits" ADD CONSTRAINT "job_permits_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jurisdictions" ADD CONSTRAINT "jurisdictions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_knowledge" ADD CONSTRAINT "permit_knowledge_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_knowledge" ADD CONSTRAINT "permit_knowledge_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_knowledge" ADD CONSTRAINT "permit_knowledge_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_parties" ADD CONSTRAINT "permit_parties_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_parties" ADD CONSTRAINT "permit_parties_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_parties" ADD CONSTRAINT "permit_parties_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_parties" ADD CONSTRAINT "permit_parties_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_review_cycles" ADD CONSTRAINT "permit_review_cycles_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_submissions" ADD CONSTRAINT "permit_submissions_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_submissions" ADD CONSTRAINT "permit_submissions_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "permit_review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_submissions" ADD CONSTRAINT "permit_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_submission_files" ADD CONSTRAINT "permit_submission_files_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "permit_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_submission_files" ADD CONSTRAINT "permit_submission_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

