-- CreateTable
CREATE TABLE "roof_rules" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "updated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roof_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roof_material_items" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "roof_type" TEXT,
    "unit_type" TEXT NOT NULL,
    "vendor_id" TEXT,
    "is_preferred" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roof_material_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roof_material_prices" (
    "id" TEXT NOT NULL,
    "material_item_id" TEXT NOT NULL,
    "unit_cost" DECIMAL(12,4) NOT NULL,
    "effective_date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roof_material_prices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roof_rules_key_key" ON "roof_rules"("key");

-- CreateIndex
CREATE INDEX "roof_material_items_category_idx" ON "roof_material_items"("category");

-- CreateIndex
CREATE INDEX "roof_material_items_vendor_id_idx" ON "roof_material_items"("vendor_id");

-- CreateIndex
CREATE INDEX "roof_material_prices_material_item_id_effective_date_idx" ON "roof_material_prices"("material_item_id", "effective_date");

-- AddForeignKey
ALTER TABLE "roof_rules" ADD CONSTRAINT "roof_rules_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_material_items" ADD CONSTRAINT "roof_material_items_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_material_prices" ADD CONSTRAINT "roof_material_prices_material_item_id_fkey" FOREIGN KEY ("material_item_id") REFERENCES "roof_material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_material_prices" ADD CONSTRAINT "roof_material_prices_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

