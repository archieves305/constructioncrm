-- Crew payments, one posting: where a crew payment was paid from, and the
-- CC Allocator bank / card line that carried it to QuickBooks. Additive.
ALTER TABLE "labor_payments" ADD COLUMN "paid_from_key" TEXT,
ADD COLUMN "paid_from_label" TEXT,
ADD COLUMN "allocator_external_id" TEXT,
ADD COLUMN "allocator_linked_at" TIMESTAMP(3),
ADD COLUMN "allocator_line_date" TIMESTAMP(3),
ADD COLUMN "allocator_line_amount" DECIMAL(12,2);

CREATE UNIQUE INDEX "labor_payments_allocator_external_id_key" ON "labor_payments"("allocator_external_id");
