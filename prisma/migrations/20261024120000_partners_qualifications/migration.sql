-- CreateEnum
CREATE TYPE "QualificationStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'INFO_REQUESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "DocumentConfidentiality" AS ENUM ('INTERNAL', 'RESTRICTED', 'SHAREABLE');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "can_view_restricted_documents" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "partner_settings" ADD COLUMN     "default_requirement_type_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "vault_owner_user_id" TEXT;

-- CreateTable
CREATE TABLE "company_document_types" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "default_validity_months" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_document_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_documents" (
    "id" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effective_date" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "confidentiality" "DocumentConfidentiality" NOT NULL DEFAULT 'INTERNAL',
    "approved_for_external" BOOLEAN NOT NULL DEFAULT false,
    "supersedes_id" TEXT,
    "notes" TEXT,
    "file_name" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "encrypted_key_version" INTEGER,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "platform" TEXT,
    "portal_url" TEXT,
    "portal_username_hint" TEXT,
    "owner_user_id" TEXT,
    "status" "QualificationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "renewal_due_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "qualification_requirements" (
    "id" TEXT NOT NULL,
    "qualification_id" TEXT NOT NULL,
    "document_type_id" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "RequirementStatus" NOT NULL DEFAULT 'PENDING',
    "company_document_id" TEXT,
    "provided_at" TIMESTAMP(3),
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qualification_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_document_types_key_key" ON "company_document_types"("key");

-- CreateIndex
CREATE INDEX "company_documents_expires_at_idx" ON "company_documents"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "company_documents_document_type_id_version_key" ON "company_documents"("document_type_id", "version");

-- CreateIndex
CREATE INDEX "qualifications_organization_id_status_idx" ON "qualifications"("organization_id", "status");

-- CreateIndex
CREATE INDEX "qualifications_expires_at_idx" ON "qualifications"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "qualification_requirements_qualification_id_document_type_i_key" ON "qualification_requirements"("qualification_id", "document_type_id");

-- AddForeignKey
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_vault_owner_user_id_fkey" FOREIGN KEY ("vault_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "company_document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_supersedes_id_fkey" FOREIGN KEY ("supersedes_id") REFERENCES "company_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualifications" ADD CONSTRAINT "qualifications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_qualification_id_fkey" FOREIGN KEY ("qualification_id") REFERENCES "qualifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_document_type_id_fkey" FOREIGN KEY ("document_type_id") REFERENCES "company_document_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qualification_requirements" ADD CONSTRAINT "qualification_requirements_company_document_id_fkey" FOREIGN KEY ("company_document_id") REFERENCES "company_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: a version is 1 or higher; an expiry never precedes the effective date.
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_version_chk" CHECK ("version" >= 1);
ALTER TABLE "company_documents" ADD CONSTRAINT "company_documents_dates_chk" CHECK ("expires_at" IS NULL OR "effective_date" IS NULL OR "expires_at" >= "effective_date");
