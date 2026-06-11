-- CreateEnum
CREATE TYPE "GeneratedDocumentType" AS ENUM ('LABOR_CONTRACT', 'CONTRACT_ADDENDUM');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FileCategory" ADD VALUE 'LABOR_CONTRACT';
ALTER TYPE "FileCategory" ADD VALUE 'CONTRACT_ADDENDUM';

-- AlterTable
ALTER TABLE "labor_change_orders" ADD COLUMN     "change_number" INTEGER,
ADD COLUMN     "scope_change" TEXT,
ADD COLUMN     "time_adjustment_days" INTEGER,
ADD COLUMN     "updated_payment_terms" TEXT;

-- AlterTable
ALTER TABLE "labor_contracts" ADD COLUMN     "contractor_insurance" TEXT,
ADD COLUMN     "contractor_license" TEXT,
ADD COLUMN     "estimated_completion_date" TIMESTAMP(3),
ADD COLUMN     "exclusions" TEXT,
ADD COLUMN     "payment_terms" TEXT,
ADD COLUMN     "start_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "labor_contract_id" TEXT,
    "change_order_id" TEXT,
    "document_type" "GeneratedDocumentType" NOT NULL,
    "version_number" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_id" TEXT,
    "generated_by_user_id" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_data_snapshot" JSONB NOT NULL,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_documents_job_id_idx" ON "generated_documents"("job_id");

-- CreateIndex
CREATE INDEX "generated_documents_labor_contract_id_idx" ON "generated_documents"("labor_contract_id");

-- CreateIndex
CREATE INDEX "generated_documents_change_order_id_idx" ON "generated_documents"("change_order_id");

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "labor_change_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generated_by_user_id_fkey" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

