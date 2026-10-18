-- Permit Intelligence, Stage 3: municipal form templates (a blank AcroForm,
-- its field inventory and each field's mapping), fills on a permit, and the
-- parcel number + legal description on the lead.

-- CreateEnum
CREATE TYPE "PermitFormKind" AS ENUM ('ACROFORM', 'XFA', 'FLAT');

-- CreateEnum
CREATE TYPE "PermitFormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "PermitFormMapState" AS ENUM ('IDLE', 'MAPPING', 'FAILED');

-- CreateEnum
CREATE TYPE "PermitFormFillStatus" AS ENUM ('DRAFT', 'FINAL');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "legal_description" TEXT,
ADD COLUMN     "parcel_number" TEXT;

-- CreateTable
CREATE TABLE "permit_form_templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction_id" TEXT,
    "county" TEXT,
    "permit_type_keys" TEXT[],
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER NOT NULL,
    "form_kind" "PermitFormKind" NOT NULL,
    "field_inventory" JSONB NOT NULL,
    "status" "PermitFormStatus" NOT NULL DEFAULT 'DRAFT',
    "map_state" "PermitFormMapState" NOT NULL DEFAULT 'IDLE',
    "map_error" TEXT,
    "map_started_at" TIMESTAMP(3),
    "ai_call_id" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "published_by_user_id" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_form_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_form_field_maps" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "field_name" TEXT NOT NULL,
    "data_key" TEXT,
    "transform" TEXT,
    "ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "rationale" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_form_field_maps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permit_form_fills" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "values" JSONB NOT NULL,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "output_file_id" TEXT,
    "flattened_file_id" TEXT,
    "status" "PermitFormFillStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" TEXT NOT NULL,
    "finalized_by_user_id" TEXT,
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_form_fills_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permit_form_templates_sha256_idx" ON "permit_form_templates"("sha256");

-- CreateIndex
CREATE INDEX "permit_form_templates_status_idx" ON "permit_form_templates"("status");

-- CreateIndex
CREATE UNIQUE INDEX "permit_form_field_maps_template_id_field_name_key" ON "permit_form_field_maps"("template_id", "field_name");

-- CreateIndex
CREATE INDEX "permit_form_fills_permit_id_idx" ON "permit_form_fills"("permit_id");

-- AddForeignKey
ALTER TABLE "permit_form_templates" ADD CONSTRAINT "permit_form_templates_jurisdiction_id_fkey" FOREIGN KEY ("jurisdiction_id") REFERENCES "jurisdictions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_templates" ADD CONSTRAINT "permit_form_templates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_templates" ADD CONSTRAINT "permit_form_templates_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_field_maps" ADD CONSTRAINT "permit_form_field_maps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "permit_form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_fills" ADD CONSTRAINT "permit_form_fills_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_fills" ADD CONSTRAINT "permit_form_fills_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "permit_form_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_fills" ADD CONSTRAINT "permit_form_fills_output_file_id_fkey" FOREIGN KEY ("output_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_fills" ADD CONSTRAINT "permit_form_fills_flattened_file_id_fkey" FOREIGN KEY ("flattened_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_fills" ADD CONSTRAINT "permit_form_fills_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_form_fills" ADD CONSTRAINT "permit_form_fills_finalized_by_user_id_fkey" FOREIGN KEY ("finalized_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
