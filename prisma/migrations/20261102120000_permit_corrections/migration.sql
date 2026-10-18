-- Permit Intelligence, Stage 2: correction notices and items, the files that
-- answer an item, drafted messages, and the text of permit PDFs for the
-- Permit Library's full-text search.
--
-- files.search_vector is a GENERATED column written by hand below; Prisma
-- reads it as a column with a default, so a later `migrate diff` prints
-- `ALTER COLUMN "search_vector" DROP DEFAULT` — leave that line out.
-- CreateEnum
CREATE TYPE "CorrectionNoticeSource" AS ENUM ('UPLOAD', 'PASTE');

-- CreateEnum
CREATE TYPE "CorrectionNoticeStatus" AS ENUM ('EXTRACTING', 'REVIEW', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "CorrectionCategory" AS ENUM ('ADMINISTRATIVE', 'TECHNICAL', 'ARCHITECTURAL', 'ENGINEERING', 'CONTRACTOR', 'ZONING', 'FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "CorrectionTarget" AS ENUM ('FORM', 'PLAN_SHEET', 'PRODUCT_APPROVAL', 'SUPPORTING_DOCUMENT', 'FEE', 'SITE', 'OTHER');

-- CreateEnum
CREATE TYPE "ResponsibleParty" AS ENUM ('KNU', 'ARCHITECT', 'ENGINEER', 'OWNER', 'SUBCONTRACTOR', 'MANUFACTURER', 'MUNICIPALITY', 'OTHER');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PROPOSED', 'OPEN', 'WAITING_THIRD_PARTY', 'RESOLVED', 'DISPUTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "CorrectionOutcome" AS ENUM ('ACCEPTED', 'RECOMMENTED');

-- CreateEnum
CREATE TYPE "PermitMessageStatus" AS ENUM ('DRAFT', 'SENT', 'DISCARDED');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "extracted_text" TEXT,
ADD COLUMN     "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, coalesce("file_name", '') || ' ' || coalesce("extracted_text", ''))) STORED;

-- CreateTable
CREATE TABLE "permit_correction_notices" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "cycle_id" TEXT NOT NULL,
    "file_id" TEXT,
    "source" "CorrectionNoticeSource" NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "raw_text" TEXT,
    "reviewer_name" TEXT,
    "response_due_at" TIMESTAMP(3),
    "status" "CorrectionNoticeStatus" NOT NULL DEFAULT 'EXTRACTING',
    "summary" TEXT,
    "ai_call_id" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "extract_started_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_correction_notices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_correction_items" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "reviewer_item_number" TEXT,
    "reviewer_discipline" TEXT,
    "text" TEXT NOT NULL,
    "source_page" INTEGER,
    "category" "CorrectionCategory" NOT NULL DEFAULT 'OTHER',
    "affects" "CorrectionTarget" NOT NULL DEFAULT 'OTHER',
    "affects_ref" TEXT,
    "responsibleParty" "ResponsibleParty" NOT NULL DEFAULT 'KNU',
    "party_id" TEXT,
    "confidence" DOUBLE PRECISION,
    "from_ai" BOOLEAN NOT NULL DEFAULT false,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PROPOSED',
    "response" TEXT,
    "due_at" TIMESTAMP(3),
    "task_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "previous_item_id" TEXT,
    "review_outcome" "CorrectionOutcome",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_correction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_correction_item_files" (
    "item_id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permit_correction_item_files_pkey" PRIMARY KEY ("item_id","file_id")
);

-- CreateTable
CREATE TABLE "permit_messages" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "party_id" TEXT,
    "to_emails" TEXT[],
    "cc_emails" TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "correction_item_ids" TEXT[],
    "attachment_file_ids" TEXT[],
    "status" "PermitMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "ai_call_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "sent_by_user_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "communication_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permit_correction_notices_permit_id_idx" ON "permit_correction_notices"("permit_id");

-- CreateIndex
CREATE INDEX "permit_correction_notices_cycle_id_idx" ON "permit_correction_notices"("cycle_id");

-- CreateIndex
CREATE INDEX "permit_correction_items_permit_id_status_idx" ON "permit_correction_items"("permit_id", "status");

-- CreateIndex
CREATE INDEX "permit_correction_items_notice_id_idx" ON "permit_correction_items"("notice_id");

-- CreateIndex
CREATE INDEX "permit_correction_item_files_file_id_idx" ON "permit_correction_item_files"("file_id");

-- CreateIndex
CREATE INDEX "permit_messages_permit_id_status_idx" ON "permit_messages"("permit_id", "status");

-- CreateIndex
CREATE INDEX "files_search_vector_idx" ON "files" USING GIN ("search_vector");

-- AddForeignKey
ALTER TABLE "permit_correction_notices" ADD CONSTRAINT "permit_correction_notices_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_notices" ADD CONSTRAINT "permit_correction_notices_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "permit_review_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_notices" ADD CONSTRAINT "permit_correction_notices_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_notices" ADD CONSTRAINT "permit_correction_notices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_notices" ADD CONSTRAINT "permit_correction_notices_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_items" ADD CONSTRAINT "permit_correction_items_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "permit_correction_notices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_items" ADD CONSTRAINT "permit_correction_items_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_items" ADD CONSTRAINT "permit_correction_items_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "permit_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_items" ADD CONSTRAINT "permit_correction_items_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_items" ADD CONSTRAINT "permit_correction_items_previous_item_id_fkey" FOREIGN KEY ("previous_item_id") REFERENCES "permit_correction_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_item_files" ADD CONSTRAINT "permit_correction_item_files_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "permit_correction_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_correction_item_files" ADD CONSTRAINT "permit_correction_item_files_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_messages" ADD CONSTRAINT "permit_messages_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_messages" ADD CONSTRAINT "permit_messages_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "permit_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_messages" ADD CONSTRAINT "permit_messages_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_messages" ADD CONSTRAINT "permit_messages_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

