-- Roof estimates: per-lead estimate records that drive both client-facing
-- and internal-accounting PDFs. roofTypesJson is an array of
-- { material, squares, laborRatePerSquare } so an estimate can mix roof
-- materials. subtotalCost + totalPrice are snapshots so the list view
-- doesn't have to recompute on every render.

-- CreateEnum
CREATE TYPE "RoofMaterial" AS ENUM ('SHINGLE', 'TILE', 'METAL', 'FLAT');

-- CreateTable
CREATE TABLE "roof_estimates" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "estimate_number" TEXT NOT NULL,
    "roof_types_json" JSONB NOT NULL,
    "permit_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dumpster_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tear_off_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "decking_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "underlayment_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "flashing_vent_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "skylight_chimney_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "gutters_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "misc_label" TEXT,
    "misc_fee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "margin_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "discount_enabled" BOOLEAN NOT NULL DEFAULT false,
    "discount_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "sales_tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "validity_days" INTEGER NOT NULL DEFAULT 30,
    "special_terms" TEXT,
    "subtotal_cost" DECIMAL(12,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roof_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roof_estimates_estimate_number_key" ON "roof_estimates"("estimate_number");

-- CreateIndex
CREATE INDEX "roof_estimates_lead_id_idx" ON "roof_estimates"("lead_id");

-- AddForeignKey
ALTER TABLE "roof_estimates" ADD CONSTRAINT "roof_estimates_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_estimates" ADD CONSTRAINT "roof_estimates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
