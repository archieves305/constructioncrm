-- CreateEnum
CREATE TYPE "LeadKind" AS ENUM ('CUSTOMER', 'GC_BID');

-- CreateEnum
CREATE TYPE "OrganizationKind" AS ENUM ('GENERAL_CONTRACTOR', 'DEVELOPER', 'PROPERTY_MANAGER', 'ARCHITECT', 'ENGINEER', 'MUNICIPALITY', 'REFERRAL_PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrganizationPriority" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "PartnerStage" AS ENUM ('TARGET', 'CONTACTED', 'ENGAGED', 'ACTIVE', 'DORMANT', 'DO_NOT_PURSUE');

-- CreateEnum
CREATE TYPE "ContactRole" AS ENUM ('ESTIMATOR', 'SENIOR_ESTIMATOR', 'PRECON_MANAGER', 'PRECON_DIRECTOR', 'PROCUREMENT', 'TRADE_PARTNER_MANAGER', 'BUSINESS_DEVELOPMENT', 'PROJECT_EXECUTIVE', 'PROJECT_MANAGER', 'SUPERINTENDENT', 'ACCOUNTS_PAYABLE', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "InteractionKind" AS ENUM ('CALL', 'EMAIL', 'MEETING', 'SITE_VISIT', 'LUNCH', 'LINKEDIN', 'INTRO', 'PREQUAL_SUBMISSION', 'BID_DISCUSSION', 'DOC_SENT', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "InteractionOutcome" AS ENUM ('NO_ANSWER', 'LEFT_MESSAGE', 'SENT', 'SPOKE', 'REPLIED', 'MEETING_HELD', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "contact_id" TEXT,
ADD COLUMN     "kind" "LeadKind" NOT NULL DEFAULT 'CUSTOMER',
ADD COLUMN     "organization_id" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "organization_id" TEXT;

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "kind" "OrganizationKind" NOT NULL DEFAULT 'GENERAL_CONTRACTOR',
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address_1" TEXT,
    "address_2" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'FL',
    "zip_code" TEXT,
    "local_offices" TEXT,
    "markets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "owner_user_id" TEXT,
    "priority" "OrganizationPriority",
    "stage" "PartnerStage" NOT NULL DEFAULT 'TARGET',
    "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_contact_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "potential_annual_revenue" DECIMAL(12,2),
    "payment_terms_days" INTEGER,
    "annual_volume" TEXT,
    "company_size" TEXT,
    "project_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "typical_project_size" TEXT,
    "bidding_platform" TEXT,
    "prequal_platform" TEXT,
    "vendor_registration_url" TEXT,
    "requirements_notes" TEXT,
    "vendor_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_trades" (
    "organization_id" TEXT NOT NULL,
    "service_category_id" TEXT NOT NULL,

    CONSTRAINT "organization_trades_pkey" PRIMARY KEY ("organization_id","service_category_id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "title" TEXT,
    "role_tag" "ContactRole" NOT NULL DEFAULT 'OTHER',
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "linkedin_url" TEXT,
    "office" TEXT,
    "geography" TEXT,
    "trades" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "relationship_strength" INTEGER,
    "influence" INTEGER,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_contact_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "interactions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "lead_id" TEXT,
    "user_id" TEXT NOT NULL,
    "kind" "InteractionKind" NOT NULL,
    "direction" "InteractionDirection" NOT NULL DEFAULT 'OUTBOUND',
    "outcome" "InteractionOutcome" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_stage_history" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "from_stage" "PartnerStage",
    "to_stage" "PartnerStage" NOT NULL,
    "reason" TEXT,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "new_target_days" INTEGER NOT NULL DEFAULT 5,
    "no_response_days" INTEGER NOT NULL DEFAULT 7,
    "qual_submitted_days" INTEGER NOT NULL DEFAULT 14,
    "prequal_no_bid_days" INTEGER NOT NULL DEFAULT 30,
    "active_quiet_days" INTEGER NOT NULL DEFAULT 60,
    "dormant_after_days" INTEGER NOT NULL DEFAULT 180,
    "default_owner_user_id" TEXT,
    "markets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_name_key_key" ON "organizations"("name_key");

-- CreateIndex
CREATE INDEX "organizations_stage_idx" ON "organizations"("stage");

-- CreateIndex
CREATE INDEX "organizations_owner_user_id_idx" ON "organizations"("owner_user_id");

-- CreateIndex
CREATE INDEX "organizations_last_contact_at_idx" ON "organizations"("last_contact_at");

-- CreateIndex
CREATE INDEX "contacts_organization_id_idx" ON "contacts"("organization_id");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_phone_idx" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "interactions_organization_id_occurred_at_idx" ON "interactions"("organization_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_contact_id_idx" ON "interactions"("contact_id");

-- CreateIndex
CREATE INDEX "interactions_lead_id_idx" ON "interactions"("lead_id");

-- CreateIndex
CREATE INDEX "partner_stage_history_organization_id_changed_at_idx" ON "partner_stage_history"("organization_id", "changed_at");

-- CreateIndex
CREATE INDEX "leads_kind_idx" ON "leads"("kind");

-- CreateIndex
CREATE INDEX "leads_organization_id_idx" ON "leads"("organization_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_idx" ON "tasks"("organization_id");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_trades" ADD CONSTRAINT "organization_trades_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_trades" ADD CONSTRAINT "organization_trades_service_category_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_stage_history" ADD CONSTRAINT "partner_stage_history_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_stage_history" ADD CONSTRAINT "partner_stage_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_default_owner_user_id_fkey" FOREIGN KEY ("default_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written (Prisma cannot express these):
-- ratings are 1–5 when given; one primary contact per organization.
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_strength_chk" CHECK ("relationship_strength" IS NULL OR "relationship_strength" BETWEEN 1 AND 5);
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_influence_chk" CHECK ("influence" IS NULL OR "influence" BETWEEN 1 AND 5);
CREATE UNIQUE INDEX "contacts_one_primary_per_org" ON "contacts"("organization_id") WHERE "is_primary";
