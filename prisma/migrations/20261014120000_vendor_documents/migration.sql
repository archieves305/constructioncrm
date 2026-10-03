-- CreateEnum
CREATE TYPE "VendorDocumentType" AS ENUM ('GL_INSURANCE', 'WORKERS_COMP', 'WC_EXEMPTION', 'W9', 'LICENSE', 'OTHER');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "vendor_id" TEXT;

-- CreateTable
CREATE TABLE "vendor_documents" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "type" "VendorDocumentType" NOT NULL,
    "carrier" TEXT,
    "policy_number" TEXT,
    "effective_date" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "file_name" TEXT,
    "file_type" TEXT,
    "file_size" INTEGER,
    "storage_key" TEXT,
    "notes" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "compliance_owner_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendor_documents_vendor_id_type_idx" ON "vendor_documents"("vendor_id", "type");

-- CreateIndex
CREATE INDEX "vendor_documents_expires_at_idx" ON "vendor_documents"("expires_at");

-- CreateIndex
CREATE INDEX "tasks_vendor_id_idx" ON "tasks"("vendor_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_documents" ADD CONSTRAINT "vendor_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settings" ADD CONSTRAINT "vendor_settings_compliance_owner_user_id_fkey" FOREIGN KEY ("compliance_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

