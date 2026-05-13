-- Add hard material cost line and free-form material selection (brand/SKU)
-- to roof estimates. material_cost is a separate hard $ for the actual
-- roofing material so labor (in $/square) and material can be tracked
-- independently in the internal breakdown.

ALTER TABLE "roof_estimates" ADD COLUMN "material_cost" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "roof_estimates" ADD COLUMN "material_selection" TEXT;
