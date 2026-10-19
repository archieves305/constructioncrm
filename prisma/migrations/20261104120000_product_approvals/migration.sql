-- Permit Intelligence, Stage 4: product approvals (FL Product Approval /
-- Miami-Dade NOA) read from their documents, linked to roofing materials and
-- to the permits that use them.

-- CreateEnum
CREATE TYPE "ApprovalAuthority" AS ENUM ('FL_PRODUCT_APPROVAL', 'MIAMI_DADE_NOA', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('UNDERLAYMENT', 'ROOF_COVERING', 'ROOF_ASSEMBLY', 'WINDOW', 'EXTERIOR_DOOR', 'GARAGE_DOOR', 'SHUTTER', 'SKYLIGHT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalReadState" AS ENUM ('EXTRACTING', 'REVIEW', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "product_approvals" (
    "id" TEXT NOT NULL,
    "authority" "ApprovalAuthority" NOT NULL DEFAULT 'OTHER',
    "approval_number" TEXT,
    "revision" TEXT,
    "manufacturer" TEXT,
    "product_name" TEXT,
    "models" TEXT[],
    "category" "ProductCategory" NOT NULL DEFAULT 'OTHER',
    "hvhz_approved" BOOLEAN,
    "non_hvhz_approved" BOOLEAN,
    "design_pressure_pos" DECIMAL(7,2),
    "design_pressure_neg" DECIMAL(7,2),
    "impact_rated" BOOLEAN,
    "limitations" TEXT,
    "configurations" JSONB,
    "issued_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "evidence" JSONB,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "read_state" "ApprovalReadState" NOT NULL DEFAULT 'EXTRACTING',
    "read_error" TEXT,
    "read_started_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ai_call_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_approval_materials" (
    "approval_id" TEXT NOT NULL,
    "roof_material_item_id" TEXT NOT NULL,

    CONSTRAINT "product_approval_materials_pkey" PRIMARY KEY ("approval_id","roof_material_item_id")
);

-- CreateTable
CREATE TABLE "permit_products" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "approval_id" TEXT NOT NULL,
    "used_as" TEXT NOT NULL DEFAULT '',
    "required_pressure_pos" DECIMAL(7,2),
    "required_pressure_neg" DECIMAL(7,2),
    "notes" TEXT,
    "document_file_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permit_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_approvals_sha256_idx" ON "product_approvals"("sha256");

-- CreateIndex
CREATE INDEX "product_approvals_approval_number_idx" ON "product_approvals"("approval_number");

-- CreateIndex
CREATE INDEX "product_approvals_expires_at_idx" ON "product_approvals"("expires_at");

-- CreateIndex
CREATE INDEX "permit_products_approval_id_idx" ON "permit_products"("approval_id");

-- CreateIndex
CREATE UNIQUE INDEX "permit_products_permit_id_approval_id_used_as_key" ON "permit_products"("permit_id", "approval_id", "used_as");

-- AddForeignKey
ALTER TABLE "product_approvals" ADD CONSTRAINT "product_approvals_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_approvals" ADD CONSTRAINT "product_approvals_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_approval_materials" ADD CONSTRAINT "product_approval_materials_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "product_approvals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_approval_materials" ADD CONSTRAINT "product_approval_materials_roof_material_item_id_fkey" FOREIGN KEY ("roof_material_item_id") REFERENCES "roof_material_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_products" ADD CONSTRAINT "permit_products_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_products" ADD CONSTRAINT "permit_products_approval_id_fkey" FOREIGN KEY ("approval_id") REFERENCES "product_approvals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_products" ADD CONSTRAINT "permit_products_document_file_id_fkey" FOREIGN KEY ("document_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;
