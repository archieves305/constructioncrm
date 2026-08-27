
-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('LUMP_SUM', 'PROGRESS');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "application_number" INTEGER,
ADD COLUMN     "period_from" DATE,
ADD COLUMN     "period_to" DATE,
ADD COLUMN     "retainage_percent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "billing_method" "BillingMethod" NOT NULL DEFAULT 'LUMP_SUM',
ADD COLUMN     "retainage_percent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sov_lines" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "item_no" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "scheduled_value" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sov_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "sov_line_id" TEXT NOT NULL,
    "work_completed" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sov_lines_job_id_idx" ON "sov_lines"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "sov_lines_job_id_item_no_key" ON "sov_lines"("job_id", "item_no");

-- CreateIndex
CREATE INDEX "invoice_lines_sov_line_id_idx" ON "invoice_lines"("sov_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_lines_invoice_id_sov_line_id_key" ON "invoice_lines"("invoice_id", "sov_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_job_id_application_number_key" ON "invoices"("job_id", "application_number");

-- AddForeignKey
ALTER TABLE "sov_lines" ADD CONSTRAINT "sov_lines_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_sov_line_id_fkey" FOREIGN KEY ("sov_line_id") REFERENCES "sov_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

