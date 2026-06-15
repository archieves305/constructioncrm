-- CreateEnum
CREATE TYPE "ChangeOrderStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'VOID');

-- CreateTable
CREATE TABLE "change_orders" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "labor_contract_id" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "customer_price" DECIMAL(12,2) NOT NULL,
    "crew_cost" DECIMAL(12,2),
    "status" "ChangeOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "token" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "decided_at" TIMESTAMP(3),
    "decision_name" TEXT,
    "decision_ip" TEXT,
    "rejection_reason" TEXT,
    "invoice_id" TEXT,
    "labor_change_order_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_token_key" ON "change_orders"("token");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_invoice_id_key" ON "change_orders"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "change_orders_labor_change_order_id_key" ON "change_orders"("labor_change_order_id");

-- CreateIndex
CREATE INDEX "change_orders_job_id_idx" ON "change_orders"("job_id");

-- CreateIndex
CREATE INDEX "change_orders_status_idx" ON "change_orders"("status");

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_labor_change_order_id_fkey" FOREIGN KEY ("labor_change_order_id") REFERENCES "labor_change_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_orders" ADD CONSTRAINT "change_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

