-- Singleton brand + per-proposal default settings, and customer-facing
-- proposal fields on roof_estimates. The brand row is seeded with the
-- NewCoast Roofing defaults so /admin/roofing-brand has something to edit
-- and the PDF has working values out of the gate.

-- ── RoofingBrand singleton ────────────────────────────────────────────────
CREATE TABLE "roofing_brand" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "company_name" TEXT NOT NULL,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "roofing_license" TEXT,
    "gc_license" TEXT,
    "logo_storage_key" TEXT,
    "default_expiration_days" INTEGER NOT NULL DEFAULT 30,
    "default_underlayment_type" TEXT,
    "default_plywood_sheets_included" INTEGER NOT NULL DEFAULT 3,
    "default_additional_plywood_price" DECIMAL(12,2) NOT NULL DEFAULT 85,
    "default_workmanship_warranty_years" INTEGER NOT NULL DEFAULT 10,
    "default_manufacturer_warranty" TEXT,
    "payment_deposit_percent" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "payment_progress_percent" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "payment_final_percent" DECIMAL(5,2) NOT NULL DEFAULT 20,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roofing_brand_pkey" PRIMARY KEY ("id")
);

INSERT INTO "roofing_brand" (
    "id", "company_name",
    "address_line_1", "city", "state", "zip",
    "phone", "email", "website",
    "roofing_license", "gc_license",
    "logo_storage_key",
    "default_underlayment_type",
    "default_manufacturer_warranty",
    "updated_at"
) VALUES (
    'default', 'NewCoast Roofing',
    '2500 N. Federal Highway, Ste 102', 'Fort Lauderdale', 'FL', '33305',
    '(561) 910-0142', 'info@newcoastroofing.com', 'www.newcoastroofing.com',
    'CCC1335024', 'CGC1528279',
    '2026-05/0462630f36b6133b761c5880866799be.png',
    'Synthetic underlayment with peel-and-stick at all eaves, valleys, and penetrations per Florida Building Code',
    'Manufacturer limited lifetime warranty subject to manufacturer terms and conditions',
    NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- ── New customer-facing fields on roof_estimates ──────────────────────────
ALTER TABLE "roof_estimates" ADD COLUMN "existing_roof_type" TEXT;
ALTER TABLE "roof_estimates" ADD COLUMN "proposed_roof_type_override" TEXT;
ALTER TABLE "roof_estimates" ADD COLUMN "underlayment_type" TEXT;
ALTER TABLE "roof_estimates" ADD COLUMN "permit_included" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "roof_estimates" ADD COLUMN "project_duration_text" TEXT;
ALTER TABLE "roof_estimates" ADD COLUMN "plywood_sheets_included" INTEGER;
ALTER TABLE "roof_estimates" ADD COLUMN "additional_plywood_price" DECIMAL(12,2);
ALTER TABLE "roof_estimates" ADD COLUMN "workmanship_warranty_years" INTEGER;
ALTER TABLE "roof_estimates" ADD COLUMN "manufacturer_warranty" TEXT;
ALTER TABLE "roof_estimates" ADD COLUMN "is_estimate_only" BOOLEAN NOT NULL DEFAULT false;
