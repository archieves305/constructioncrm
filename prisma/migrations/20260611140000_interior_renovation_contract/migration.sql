-- AlterEnum
ALTER TYPE "FileCategory" ADD VALUE 'INTERIOR_RENOVATION_LABOR_CONTRACT';

-- AlterEnum
ALTER TYPE "GeneratedDocumentType" ADD VALUE 'INTERIOR_RENOVATION_LABOR_CONTRACT';

-- AlterTable
ALTER TABLE "labor_change_orders" ADD COLUMN     "added_scope" TEXT,
ADD COLUMN     "payment_impact" TEXT,
ADD COLUMN     "removed_scope" TEXT,
ADD COLUMN     "retainage_impact" TEXT;

-- AlterTable
ALTER TABLE "labor_contracts" ADD COLUMN     "delay_damages_per_day" DECIMAL(12,2),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "retainage_percent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "labor_contract_tasks" (
    "id" TEXT NOT NULL,
    "labor_contract_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "room" TEXT,
    "description" TEXT,
    "payment_amount" DECIMAL(12,2),
    "payment_percent" DECIMAL(5,2),
    "inspection_required" BOOLEAN NOT NULL DEFAULT true,
    "inspection_status" TEXT NOT NULL DEFAULT 'PENDING',
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "approved_by" TEXT,
    "approved_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_contract_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_contract_tasks_labor_contract_id_idx" ON "labor_contract_tasks"("labor_contract_id");

-- AddForeignKey
ALTER TABLE "labor_contract_tasks" ADD CONSTRAINT "labor_contract_tasks_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

