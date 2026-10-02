-- CreateEnum
CREATE TYPE "LaborPaymentRequestStatus" AS ENUM ('REQUESTED', 'PAID', 'CANCELLED', 'CLOSED_UNPAID');

-- AlterTable
ALTER TABLE "labor_contract_tasks" ADD COLUMN     "assigned_user_id" TEXT,
ADD COLUMN     "due_date" TIMESTAMP(3),
ADD COLUMN     "payment_request_id" TEXT,
ADD COLUMN     "task_id" TEXT;

-- CreateTable
CREATE TABLE "labor_payment_requests" (
    "id" TEXT NOT NULL,
    "labor_contract_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "needed_by" DATE,
    "status" "LaborPaymentRequestStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_by_user_id" TEXT NOT NULL,
    "task_id" TEXT,
    "labor_payment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "labor_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "labor_payment_requests_task_id_key" ON "labor_payment_requests"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "labor_payment_requests_labor_payment_id_key" ON "labor_payment_requests"("labor_payment_id");

-- CreateIndex
CREATE INDEX "labor_payment_requests_labor_contract_id_idx" ON "labor_payment_requests"("labor_contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "labor_contract_tasks_task_id_key" ON "labor_contract_tasks"("task_id");

-- CreateIndex
CREATE INDEX "labor_contract_tasks_payment_request_id_idx" ON "labor_contract_tasks"("payment_request_id");

-- AddForeignKey
ALTER TABLE "labor_contract_tasks" ADD CONSTRAINT "labor_contract_tasks_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_contract_tasks" ADD CONSTRAINT "labor_contract_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_contract_tasks" ADD CONSTRAINT "labor_contract_tasks_payment_request_id_fkey" FOREIGN KEY ("payment_request_id") REFERENCES "labor_payment_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_payment_requests" ADD CONSTRAINT "labor_payment_requests_labor_contract_id_fkey" FOREIGN KEY ("labor_contract_id") REFERENCES "labor_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_payment_requests" ADD CONSTRAINT "labor_payment_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_payment_requests" ADD CONSTRAINT "labor_payment_requests_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_payment_requests" ADD CONSTRAINT "labor_payment_requests_labor_payment_id_fkey" FOREIGN KEY ("labor_payment_id") REFERENCES "labor_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

