-- User signature overrides (optional per-user; falls back to EmailBrand defaults)
ALTER TABLE "users" ADD COLUMN "signature_html" TEXT;
ALTER TABLE "users" ADD COLUMN "signature_text" TEXT;

-- Lead-level email opt-out for unsubscribe support
ALTER TABLE "leads" ADD COLUMN "email_opted_out" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leads" ADD COLUMN "email_opted_out_at" TIMESTAMP(3);

-- Singleton-style EmailBrand table
CREATE TABLE "email_brand" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "company_name" TEXT NOT NULL,
    "address_line_1" TEXT,
    "address_line_2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "office_phone" TEXT,
    "mobile_phone" TEXT,
    "contact_email" TEXT,
    "website" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT NOT NULL DEFAULT '#1f2937',
    "signature_html" TEXT,
    "signature_text" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_brand_pkey" PRIMARY KEY ("id")
);

-- Seed KNU defaults (idempotent — safe if migration is re-run via prisma migrate reset)
INSERT INTO "email_brand" (
    "id", "company_name", "address_line_1", "city", "state", "zip",
    "office_phone", "mobile_phone", "primary_color", "updated_at"
) VALUES (
    'default',
    'Knu Construction',
    '2500 N Federal Highway, Suite 102',
    'Ft Lauderdale',
    'FL',
    '33305',
    '(561) 910-0142',
    '(561) 785-9122',
    '#1f2937',
    NOW()
) ON CONFLICT ("id") DO NOTHING;
