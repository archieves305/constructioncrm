-- CreateTable
CREATE TABLE "labor_contracts" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "crew_id" TEXT,
    "label" TEXT,
    "contract_amount" DECIMAL(12,2) NOT NULL,
    "description" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "labor_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_payments" (
    "id" TEXT NOT NULL,
    "labor_contract_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod",
    "reference" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labor_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "labor_contracts_job_id_idx" ON "labor_contracts"("job_id");

-- CreateIndex
CREATE INDEX "labor_payments_labor_contract_id_idx" ON "labor_payments"("labor_contract_id");

-- AddForeignKey
ALTER TABLE "labor_contracts" ADD CONSTRAINT "labor_contracts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_contracts" ADD CONSTRAINT "labor_contracts_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_contracts" ADD CONSTRAINT "labor_contracts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_payments" ADD CONSTRAINT "labor_payments_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_payments" ADD CONSTRAINT "labor_payments_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
