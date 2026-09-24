-- AlterTable
ALTER TABLE "sov_lines" ADD COLUMN     "change_order_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "sov_lines_change_order_id_key" ON "sov_lines"("change_order_id");

-- AddForeignKey
ALTER TABLE "sov_lines" ADD CONSTRAINT "sov_lines_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "change_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

