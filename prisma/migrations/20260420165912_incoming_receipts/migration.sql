-- CreateEnum
CREATE TYPE "IncomingReceiptStatus" AS ENUM ('UNMATCHED', 'MATCHED', 'DISMISSED');

-- CreateTable
CREATE TABLE "incoming_receipts" (
    "id" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "po_text" TEXT,
    "purchase_date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "IncomingReceiptStatus" NOT NULL DEFAULT 'UNMATCHED',
    "matched_job_id" TEXT,
    "job_expense_id" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incoming_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incoming_receipts_status_idx" ON "incoming_receipts"("status");

-- CreateIndex
CREATE INDEX "incoming_receipts_matched_job_id_idx" ON "incoming_receipts"("matched_job_id");

-- AddForeignKey
ALTER TABLE "incoming_receipts" ADD CONSTRAINT "incoming_receipts_matched_job_id_fkey" FOREIGN KEY ("matched_job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_receipts" ADD CONSTRAINT "incoming_receipts_job_expense_id_fkey" FOREIGN KEY ("job_expense_id") REFERENCES "job_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incoming_receipts" ADD CONSTRAINT "incoming_receipts_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
