-- CreateTable
CREATE TABLE "labor_change_orders" (
    "id" TEXT NOT NULL,
    "labor_contract_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "change_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_change_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_change_orders_labor_contract_id_idx" ON "labor_change_orders"("labor_contract_id");

-- AddForeignKey
ALTER TABLE "labor_change_orders" ADD CONSTRAINT "labor_change_orders_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_change_orders" ADD CONSTRAINT "labor_change_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

