-- AlterTable
ALTER TABLE "files" ADD COLUMN     "labor_payment_id" TEXT,
ADD COLUMN     "labor_payment_request_id" TEXT,
ADD COLUMN     "taken_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "files_labor_payment_request_id_idx" ON "files"("labor_payment_request_id");

-- CreateIndex
CREATE INDEX "files_labor_payment_id_idx" ON "files"("labor_payment_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_labor_payment_request_id_fkey" FOREIGN KEY ("labor_payment_request_id") REFERENCES "labor_payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_labor_payment_id_fkey" FOREIGN KEY ("labor_payment_id") REFERENCES "labor_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

