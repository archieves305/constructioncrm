-- CreateEnum
CREATE TYPE "BidPlatform" AS ENUM ('BUILDINGCONNECTED', 'PROCORE', 'PLANHUB', 'SMARTBID', 'CONSTRUCTCONNECT', 'TEXTURA', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('TRACKING', 'INVITED', 'DECIDING', 'ESTIMATING', 'SUBMITTED', 'SHORTLISTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BidDecision" AS ENUM ('UNDECIDED', 'BID', 'NO_BID');

-- CreateEnum
CREATE TYPE "BidOutcome" AS ENUM ('AWARDED', 'LOST', 'NO_BID', 'CANCELLED', 'NO_DECISION', 'REBID');

-- CreateEnum
CREATE TYPE "BidLossReason" AS ENUM ('PRICE', 'RELATIONSHIP', 'SCHEDULE', 'SCOPE', 'QUALIFICATION', 'BONDING', 'CAPACITY', 'COMPETITOR', 'UNKNOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "BidSubmissionKind" AS ENUM ('ORIGINAL', 'REVISED', 'ALTERNATE', 'VALUE_ENGINEERING');

-- CreateEnum
CREATE TYPE "BidSubmissionMethod" AS ENUM ('PLATFORM', 'EMAIL', 'PORTAL', 'HAND', 'OTHER');

-- AlterTable
ALTER TABLE "partner_settings" ADD COLUMN     "adjacent_counties" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bonding_capacity" DECIMAL(12,2),
ADD COLUMN     "home_counties" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "our_trade_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "score_weights" JSONB,
ADD COLUMN     "score_weights_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "typical_range" JSONB;

-- CreateTable
CREATE TABLE "bid_invitations" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "number" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "project_type" TEXT,
    "scope_summary" TEXT,
    "invited_at" TIMESTAMP(3),
    "bid_due_at" TIMESTAMP(3),
    "site_walk_at" TIMESTAMP(3),
    "pre_bid_meeting_at" TIMESTAMP(3),
    "rfi_due_at" TIMESTAMP(3),
    "addenda_deadline_at" TIMESTAMP(3),
    "interview_at" TIMESTAMP(3),
    "expected_award_at" TIMESTAMP(3),
    "addenda_count" INTEGER NOT NULL DEFAULT 0,
    "specs_received" BOOLEAN NOT NULL DEFAULT false,
    "estimator_user_id" TEXT,
    "site_visit_required" BOOLEAN NOT NULL DEFAULT false,
    "bond_required" BOOLEAN NOT NULL DEFAULT false,
    "prevailing_wage" BOOLEAN NOT NULL DEFAULT false,
    "union_required" BOOLEAN NOT NULL DEFAULT false,
    "insurance_notes" TEXT,
    "schedule_notes" TEXT,
    "platform" "BidPlatform" NOT NULL DEFAULT 'EMAIL',
    "platform_url" TEXT,
    "platform_ref" TEXT,
    "status" "BidStatus" NOT NULL DEFAULT 'INVITED',
    "waiting_on" TEXT,
    "decision" "BidDecision" NOT NULL DEFAULT 'UNDECIDED',
    "decision_score" INTEGER,
    "decision_factors" JSONB,
    "decision_reason" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "submitted_at" TIMESTAMP(3),
    "estimating_hours" DECIMAL(6,1),
    "outcome" "BidOutcome",
    "loss_reason" "BidLossReason",
    "winning_contractor" TEXT,
    "winning_price" DECIMAL(12,2),
    "outcome_notes" TEXT,
    "outcome_at" TIMESTAMP(3),
    "awarded_amount" DECIMAL(12,2),
    "contract_received_at" TIMESTAMP(3),
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "signal_source" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_submissions" (
    "id" TEXT NOT NULL,
    "bid_invitation_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "BidSubmissionKind" NOT NULL DEFAULT 'ORIGINAL',
    "amount" DECIMAL(12,2) NOT NULL,
    "estimate_id" TEXT,
    "roof_estimate_id" TEXT,
    "snapshot_total_price" DECIMAL(12,2),
    "snapshot_subtotal_cost" DECIMAL(12,2),
    "submitted_at" TIMESTAMP(3) NOT NULL,
    "method" "BidSubmissionMethod" NOT NULL DEFAULT 'PLATFORM',
    "recipient_contact_id" TEXT,
    "alternates" TEXT,
    "clarifications" TEXT,
    "exclusions" TEXT,
    "file_id" TEXT,
    "submitted_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_invitations_lead_id_key" ON "bid_invitations"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "bid_invitations_number_key" ON "bid_invitations"("number");

-- CreateIndex
CREATE INDEX "bid_invitations_organization_id_status_idx" ON "bid_invitations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "bid_invitations_status_idx" ON "bid_invitations"("status");

-- CreateIndex
CREATE INDEX "bid_invitations_bid_due_at_idx" ON "bid_invitations"("bid_due_at");

-- CreateIndex
CREATE INDEX "bid_invitations_estimator_user_id_idx" ON "bid_invitations"("estimator_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bid_submissions_bid_invitation_id_version_key" ON "bid_submissions"("bid_invitation_id", "version");

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_estimator_user_id_fkey" FOREIGN KEY ("estimator_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_decided_by_user_id_fkey" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_roof_estimate_id_fkey" FOREIGN KEY ("roof_estimate_id") REFERENCES "roof_estimates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_recipient_contact_id_fkey" FOREIGN KEY ("recipient_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: the bid number sequence and the invariants Prisma cannot express.
CREATE SEQUENCE IF NOT EXISTS "bid_invitation_number_seq" START 1;
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_outcome_closed_chk" CHECK ("outcome" IS NULL OR "status" = 'CLOSED');
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_awarded_amount_chk" CHECK ("awarded_amount" IS NULL OR "outcome" = 'AWARDED');
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_score_chk" CHECK ("decision_score" IS NULL OR "decision_score" BETWEEN 0 AND 100);
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submission_one_source_chk" CHECK (num_nonnulls("estimate_id", "roof_estimate_id") <= 1);
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submission_version_chk" CHECK ("version" >= 1);
