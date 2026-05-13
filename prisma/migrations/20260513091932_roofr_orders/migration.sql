-- CreateEnum
CREATE TYPE "RoofrOrderStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateTable
CREATE TABLE "roofr_orders" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "RoofrOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "external_order_id" TEXT,
    "report_url" TEXT,
    "notes" TEXT,
    "error_message" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roofr_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roofr_orders_lead_id_idx" ON "roofr_orders"("lead_id");

-- AddForeignKey
ALTER TABLE "roofr_orders" ADD CONSTRAINT "roofr_orders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roofr_orders" ADD CONSTRAINT "roofr_orders_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
