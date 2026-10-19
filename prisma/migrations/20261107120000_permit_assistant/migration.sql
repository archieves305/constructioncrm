-- The permit document assistant: runs, the documents it read or fetched, and
-- every web request it made. Jurisdictions gain a website and allowed sites.

-- CreateEnum
CREATE TYPE "PermitAssistRunStatus" AS ENUM ('RUNNING', 'DONE');

-- CreateEnum
CREATE TYPE "PermitAssistSource" AS ENUM ('UPLOAD', 'LINK', 'SITE');

-- CreateEnum
CREATE TYPE "PermitAssistItemStatus" AS ENUM ('QUEUED', 'READING', 'PROPOSED', 'ACCEPTED', 'REJECTED', 'PAGE', 'FAILED');

-- AlterTable
ALTER TABLE "jurisdictions" ADD COLUMN     "allowed_hosts" TEXT[],
ADD COLUMN     "website_url" TEXT;

-- CreateTable
CREATE TABLE "permit_assist_runs" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "status" "PermitAssistRunStatus" NOT NULL DEFAULT 'RUNNING',
    "search_site" BOOLEAN NOT NULL DEFAULT false,
    "fetch_count" INTEGER NOT NULL DEFAULT 0,
    "started_by_user_id" TEXT,
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_assist_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_assist_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "source" "PermitAssistSource" NOT NULL,
    "parent_item_id" TEXT,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "link_text" TEXT,
    "url" TEXT,
    "final_url" TEXT,
    "file_id" TEXT,
    "storage_key" TEXT,
    "file_name" TEXT,
    "file_type" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "status" "PermitAssistItemStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "error" TEXT,
    "suggested_type" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "findings" JSONB,
    "links" JSONB,
    "ai_call_id" TEXT,
    "approval_id" TEXT,
    "decided_type" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_assist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_assist_fetches" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "item_id" TEXT,
    "url" TEXT NOT NULL,
    "final_url" TEXT,
    "http_status" INTEGER,
    "content_type" TEXT,
    "bytes" INTEGER,
    "outcome" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permit_assist_fetches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permit_assist_runs_permit_id_created_at_idx" ON "permit_assist_runs"("permit_id", "created_at");

-- CreateIndex
CREATE INDEX "permit_assist_items_run_id_status_idx" ON "permit_assist_items"("run_id", "status");

-- CreateIndex
CREATE INDEX "permit_assist_items_permit_id_idx" ON "permit_assist_items"("permit_id");

-- CreateIndex
CREATE INDEX "permit_assist_fetches_run_id_idx" ON "permit_assist_fetches"("run_id");

-- AddForeignKey
ALTER TABLE "permit_assist_runs" ADD CONSTRAINT "permit_assist_runs_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_assist_runs" ADD CONSTRAINT "permit_assist_runs_started_by_user_id_fkey" FOREIGN KEY ("started_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_assist_items" ADD CONSTRAINT "permit_assist_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "permit_assist_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_assist_items" ADD CONSTRAINT "permit_assist_items_parent_item_id_fkey" FOREIGN KEY ("parent_item_id") REFERENCES "permit_assist_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_assist_items" ADD CONSTRAINT "permit_assist_items_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_assist_items" ADD CONSTRAINT "permit_assist_items_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_assist_fetches" ADD CONSTRAINT "permit_assist_fetches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "permit_assist_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
