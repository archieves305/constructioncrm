-- CreateEnum
CREATE TYPE "EstimateTemplateCategory" AS ENUM ('ROOFING', 'DRYWALL', 'INTERIOR_RENOVATION', 'WINDOWS_DOORS');
-- CreateEnum
CREATE TYPE "EstimateUnitType" AS ENUM ('EACH', 'OPENING', 'SHEET', 'SQ_FT', 'LINEAR_FT', 'ROOM', 'LUMP_SUM', 'LABOR_HOUR');
-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');
-- CreateTable
CREATE TABLE "estimate_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" "EstimateTemplateCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estimate_templates_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "estimate_template_sections" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estimate_template_sections_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "estimate_template_line_items" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit_type" "EstimateUnitType" NOT NULL,
    "default_quantity" DECIMAL(12,2),
    "default_unit_price" DECIMAL(12,2),
    "default_notes" TEXT,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estimate_template_line_items_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "estimates" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "template_id" TEXT,
    "template_category" "EstimateTemplateCategory" NOT NULL,
    "estimate_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EstimateStatus" NOT NULL DEFAULT 'DRAFT',
    "margin_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "discount_enabled" BOOLEAN NOT NULL DEFAULT false,
    "discount_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "sales_tax_percent" DECIMAL(6,3) NOT NULL DEFAULT 0,
    "validity_days" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "exclusions" TEXT,
    "subtotal_cost" DECIMAL(12,2) NOT NULL,
    "total_price" DECIMAL(12,2) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "estimate_sections" (
    "id" TEXT NOT NULL,
    "estimate_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estimate_sections_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "estimate_line_items" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit_type" "EstimateUnitType" NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unit_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "line_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "estimate_line_items_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "estimate_templates_key_key" ON "estimate_templates"("key");
-- CreateIndex
CREATE INDEX "estimate_template_sections_template_id_idx" ON "estimate_template_sections"("template_id");
-- CreateIndex
CREATE INDEX "estimate_template_line_items_section_id_idx" ON "estimate_template_line_items"("section_id");
-- CreateIndex
CREATE UNIQUE INDEX "estimates_estimate_number_key" ON "estimates"("estimate_number");
-- CreateIndex
CREATE INDEX "estimates_lead_id_idx" ON "estimates"("lead_id");
-- CreateIndex
CREATE INDEX "estimates_template_category_idx" ON "estimates"("template_category");
-- CreateIndex
CREATE INDEX "estimate_sections_estimate_id_idx" ON "estimate_sections"("estimate_id");
-- CreateIndex
CREATE INDEX "estimate_line_items_section_id_idx" ON "estimate_line_items"("section_id");
-- AddForeignKey
ALTER TABLE "estimate_template_sections" ADD CONSTRAINT "estimate_template_sections_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "estimate_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "estimate_template_line_items" ADD CONSTRAINT "estimate_template_line_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "estimate_template_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "estimate_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "estimate_sections" ADD CONSTRAINT "estimate_sections_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "estimate_line_items" ADD CONSTRAINT "estimate_line_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "estimate_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
