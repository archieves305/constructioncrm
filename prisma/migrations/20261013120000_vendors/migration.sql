-- CreateEnum
CREATE TYPE "VendorKind" AS ENUM ('SUBCONTRACTOR', 'SUPPLIER', 'OTHER');

-- AlterTable
ALTER TABLE "crews" ADD COLUMN     "vendor_id" TEXT;

-- AlterTable
ALTER TABLE "job_expenses" ADD COLUMN     "vendor_id" TEXT;

-- AlterTable
ALTER TABLE "labor_contracts" ADD COLUMN     "vendor_id" TEXT;

-- CreateTable
CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "VendorKind" NOT NULL DEFAULT 'SUPPLIER',
    "trade" TEXT,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_aliases" (
    "id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "pattern" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendors_name_idx" ON "vendors"("name");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_aliases_pattern_key" ON "vendor_aliases"("pattern");

-- CreateIndex
CREATE INDEX "vendor_aliases_vendor_id_idx" ON "vendor_aliases"("vendor_id");

-- CreateIndex
CREATE INDEX "crews_vendor_id_idx" ON "crews"("vendor_id");

-- CreateIndex
CREATE INDEX "job_expenses_vendor_id_idx" ON "job_expenses"("vendor_id");

-- CreateIndex
CREATE INDEX "labor_contracts_vendor_id_idx" ON "labor_contracts"("vendor_id");

-- AddForeignKey
ALTER TABLE "crews" ADD CONSTRAINT "crews_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_aliases" ADD CONSTRAINT "vendor_aliases_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_contracts" ADD CONSTRAINT "labor_contracts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_expenses" ADD CONSTRAINT "job_expenses_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

