-- CreateEnum
CREATE TYPE "CustomerContractStatus" AS ENUM ('DRAFT', 'SENT', 'SIGNED', 'DECLINED', 'VOID');

-- CreateEnum
CREATE TYPE "ContractTemplateVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- AlterEnum
ALTER TYPE "FileCategory" ADD VALUE 'CUSTOMER_CONTRACT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "GeneratedDocumentType" ADD VALUE 'CUSTOMER_CONTRACT';
ALTER TYPE "GeneratedDocumentType" ADD VALUE 'CUSTOMER_CONTRACT_SIGNED';

-- AlterTable
ALTER TABLE "generated_documents" ADD COLUMN     "customer_contract_id" TEXT;

-- CreateTable
CREATE TABLE "contract_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ContractTemplateVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "articles" JSONB NOT NULL DEFAULT '[]',
    "payment_schedule" JSONB NOT NULL,
    "payment_schedule_text" TEXT NOT NULL,
    "consent_text" TEXT NOT NULL,
    "change_notes" TEXT,
    "content_hash" TEXT NOT NULL,
    "source_version_id" TEXT,
    "created_by_user_id" TEXT,
    "published_by_user_id" TEXT,
    "published_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_contracts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "contract_number" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,
    "estimate_id" TEXT,
    "roof_estimate_id" TEXT,
    "status" "CustomerContractStatus" NOT NULL DEFAULT 'DRAFT',
    "contract_amount" DECIMAL(12,2) NOT NULL,
    "deposit_amount" DECIMAL(12,2) NOT NULL,
    "payment_schedule" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "snapshot_version" INTEGER NOT NULL DEFAULT 1,
    "token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "sent_to_email" TEXT,
    "sent_by_user_id" TEXT,
    "unsigned_pdf_sha256" TEXT,
    "signed_at" TIMESTAMP(3),
    "signer_name" TEXT,
    "signer_email" TEXT,
    "signer_ip" TEXT,
    "signer_user_agent" TEXT,
    "consent_text" TEXT,
    "consent_at" TIMESTAMP(3),
    "signature_storage_key" TEXT,
    "signed_pdf_sha256" TEXT,
    "money_applied_at" TIMESTAMP(3),
    "money_apply_note" TEXT,
    "declined_at" TIMESTAMP(3),
    "decline_reason" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by_user_id" TEXT,
    "void_reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contract_templates_key_key" ON "contract_templates"("key");

-- CreateIndex
CREATE INDEX "contract_template_versions_template_id_status_idx" ON "contract_template_versions"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "contract_template_versions_template_id_version_key" ON "contract_template_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contracts_contract_number_key" ON "customer_contracts"("contract_number");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contracts_token_key" ON "customer_contracts"("token");

-- CreateIndex
CREATE INDEX "customer_contracts_job_id_status_idx" ON "customer_contracts"("job_id", "status");

-- CreateIndex
CREATE INDEX "customer_contracts_lead_id_idx" ON "customer_contracts"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_contracts_job_id_number_key" ON "customer_contracts"("job_id", "number");

-- CreateIndex
CREATE INDEX "generated_documents_customer_contract_id_idx" ON "generated_documents"("customer_contract_id");

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_customer_contract_id_fkey" FOREIGN KEY ("customer_contract_id") REFERENCES "customer_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "contract_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_template_versions" ADD CONSTRAINT "contract_template_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "contract_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_roof_estimate_id_fkey" FOREIGN KEY ("roof_estimate_id") REFERENCES "roof_estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_sent_by_user_id_fkey" FOREIGN KEY ("sent_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_voided_by_user_id_fkey" FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Exactly one source estimate per contract (hand-appended; Prisma has no CHECK support).
ALTER TABLE "customer_contracts" ADD CONSTRAINT "customer_contracts_one_source_chk" CHECK (num_nonnulls("estimate_id", "roof_estimate_id") = 1);
