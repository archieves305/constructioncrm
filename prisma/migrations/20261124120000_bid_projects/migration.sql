-- CreateEnum
CREATE TYPE "BidProjectStage" AS ENUM ('OPEN', 'PRIME_AWARDED', 'POSTPONED', 'REBIDDING', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BidPrimeStatus" AS ENUM ('UNKNOWN', 'PENDING', 'GC_AWARDED', 'GC_LOST', 'REBIDDING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidScopeStatus" AS ENUM ('PENDING', 'VERBAL', 'AWARDED', 'EXECUTED', 'LOST', 'WITHDRAWN', 'NO_BID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidAwardKind" AS ENUM ('VERBAL', 'WRITTEN', 'EXECUTED');

-- CreateEnum
CREATE TYPE "BidProposalStatus" AS ENUM ('EXTRACTING', 'REVIEW', 'VERIFIED', 'FAILED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BidProposalLineKind" AS ENUM ('BASE', 'ALTERNATE', 'ALLOWANCE', 'UNIT');

-- CreateEnum
CREATE TYPE "BidFollowUpKind" AS ENUM ('CALL', 'EMAIL', 'REVIEW', 'URGENT_CALL');

-- CreateEnum
CREATE TYPE "BidFollowUpStatus" AS ENUM ('PLANNED', 'RAISED', 'DONE', 'CANCELLED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "BidMessageStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENDING', 'SENT', 'FAILED', 'UNCERTAIN', 'CANCELLED');

-- AlterEnum
ALTER TYPE "BidStatus" ADD VALUE 'READY_TO_SUBMIT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BidLossReason" ADD VALUE 'GC_LOST_PRIME';
ALTER TYPE "BidLossReason" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "bid_invitation_id" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "bid_project_id" TEXT,
ADD COLUMN     "sha256" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "source_bid_award_id" TEXT;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "email_suppressed_at" TIMESTAMP(3),
ADD COLUMN     "suppress_reason" TEXT;

-- AlterTable
ALTER TABLE "interactions" ADD COLUMN     "bid_invitation_id" TEXT;

-- AlterTable
ALTER TABLE "bid_invitations" ADD COLUMN     "bid_project_id" TEXT,
ADD COLUMN     "cadence_anchor_at" TIMESTAMP(3),
ADD COLUMN     "last_meaningful_contact_at" TIMESTAMP(3),
ADD COLUMN     "next_action_at" TIMESTAMP(3),
ADD COLUMN     "next_action_label" TEXT,
ADD COLUMN     "pause_reason" TEXT,
ADD COLUMN     "pause_scope" TEXT,
ADD COLUMN     "paused_until" TIMESTAMP(3),
ADD COLUMN     "pm_user_id" TEXT,
ADD COLUMN     "prime_status" "BidPrimeStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "purchasing_contact_id" TEXT,
ADD COLUMN     "requested_follow_up_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bid_submissions" ADD COLUMN     "confirmed_via" TEXT,
ADD COLUMN     "evidence_file_id" TEXT,
ADD COLUMN     "proposal_version_id" TEXT;

-- CreateTable
CREATE TABLE "bid_projects" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address1" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'FL',
    "zip_code" TEXT,
    "county" TEXT,
    "address_key" TEXT,
    "time_zone" TEXT NOT NULL DEFAULT 'America/New_York',
    "source" "BidPlatform" NOT NULL DEFAULT 'PLANHUB',
    "platform_ref" TEXT,
    "platform_url" TEXT,
    "owner_name" TEXT,
    "project_type" TEXT,
    "stage" "BidProjectStage" NOT NULL DEFAULT 'OPEN',
    "stage_reason" TEXT,
    "stage_review_at" TIMESTAMP(3),
    "owner_bid_due_at" TIMESTAMP(3),
    "expected_prime_award_at" TIMESTAMP(3),
    "expected_start_at" TIMESTAMP(3),
    "notes" TEXT,
    "owner_user_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_project_scopes" (
    "id" TEXT NOT NULL,
    "bid_project_id" TEXT NOT NULL,
    "service_category_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_project_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_opportunity_scopes" (
    "id" TEXT NOT NULL,
    "bid_invitation_id" TEXT NOT NULL,
    "scope_id" TEXT NOT NULL,
    "status" "BidScopeStatus" NOT NULL DEFAULT 'PENDING',
    "quoted_amount" DECIMAL(12,2),
    "award_id" TEXT,
    "loss_reason" "BidLossReason",
    "notes" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_opportunity_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_awards" (
    "id" TEXT NOT NULL,
    "bid_invitation_id" TEXT NOT NULL,
    "kind" "BidAwardKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "awarded_at" TIMESTAMP(3) NOT NULL,
    "evidence_file_id" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_proposals" (
    "id" TEXT NOT NULL,
    "bid_project_id" TEXT NOT NULL,
    "number" TEXT,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_proposal_versions" (
    "id" TEXT NOT NULL,
    "bid_proposal_id" TEXT NOT NULL,
    "bid_project_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "file_id" TEXT,
    "sha256" TEXT,
    "status" "BidProposalStatus" NOT NULL DEFAULT 'EXTRACTING',
    "extract_attempts" INTEGER NOT NULL DEFAULT 0,
    "extract_started_at" TIMESTAMP(3),
    "extract_error" TEXT,
    "ai_call_id" TEXT,
    "extracted" JSONB,
    "proposal_date" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "total" DECIMAL(12,2),
    "bundle_adjustment" DECIMAL(12,2),
    "inclusions" TEXT,
    "exclusions" TEXT,
    "alternates" TEXT,
    "clarifications" TEXT,
    "organization_id" TEXT,
    "verified_by_user_id" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_proposal_lines" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "scope_id" TEXT,
    "kind" "BidProposalLineKind" NOT NULL DEFAULT 'BASE',
    "description" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "bid_proposal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_submission_recipients" (
    "id" TEXT NOT NULL,
    "submission_id" TEXT NOT NULL,
    "contact_id" TEXT,
    "email_snapshot" TEXT,
    "name_snapshot" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_submission_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_follow_up_actions" (
    "id" TEXT NOT NULL,
    "bid_invitation_id" TEXT NOT NULL,
    "slot_key" TEXT NOT NULL,
    "kind" "BidFollowUpKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "BidFollowUpStatus" NOT NULL DEFAULT 'PLANNED',
    "task_id" TEXT,
    "message_id" TEXT,
    "plan_inputs" JSONB,
    "outcome" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_follow_up_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_messages" (
    "id" TEXT NOT NULL,
    "bid_invitation_id" TEXT NOT NULL,
    "template_key" TEXT,
    "proposal_version_id" TEXT,
    "to_contact_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "to_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cc_emails" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "BidMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "sender_user_id" TEXT,
    "ai_call_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "send_after" TIMESTAMP(3),
    "send_started_at" TIMESTAMP(3),
    "sent_by_user_id" TEXT,
    "sent_at" TIMESTAMP(3),
    "external_message_id" TEXT,
    "communication_id" TEXT,
    "error" TEXT,
    "cancel_reason" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_email_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "auto_sendable" BOOLEAN NOT NULL DEFAULT false,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_follow_up_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "cadence" JSONB,
    "call_hour" INTEGER NOT NULL DEFAULT 9,
    "draft_hour" INTEGER NOT NULL DEFAULT 7,
    "send_window_start_hour" INTEGER NOT NULL DEFAULT 8,
    "send_window_end_hour" INTEGER NOT NULL DEFAULT 17,
    "escalate_after_days" INTEGER NOT NULL DEFAULT 2,
    "auto_send_enabled" BOOLEAN NOT NULL DEFAULT false,
    "overrides" JSONB,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_follow_up_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_holidays" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_projects_number_key" ON "bid_projects"("number");

-- CreateIndex
CREATE INDEX "bid_projects_stage_idx" ON "bid_projects"("stage");

-- CreateIndex
CREATE INDEX "bid_projects_address_key_idx" ON "bid_projects"("address_key");

-- CreateIndex
CREATE INDEX "bid_projects_owner_user_id_idx" ON "bid_projects"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "bid_project_scopes_bid_project_id_service_category_id_label_key" ON "bid_project_scopes"("bid_project_id", "service_category_id", "label");

-- CreateIndex
CREATE INDEX "bid_opportunity_scopes_scope_id_idx" ON "bid_opportunity_scopes"("scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "bid_opportunity_scopes_bid_invitation_id_scope_id_key" ON "bid_opportunity_scopes"("bid_invitation_id", "scope_id");

-- CreateIndex
CREATE INDEX "bid_awards_bid_invitation_id_idx" ON "bid_awards"("bid_invitation_id");

-- CreateIndex
CREATE INDEX "bid_proposals_bid_project_id_idx" ON "bid_proposals"("bid_project_id");

-- CreateIndex
CREATE INDEX "bid_proposal_versions_status_idx" ON "bid_proposal_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bid_proposal_versions_bid_proposal_id_version_key" ON "bid_proposal_versions"("bid_proposal_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "bid_proposal_versions_bid_project_id_sha256_key" ON "bid_proposal_versions"("bid_project_id", "sha256");

-- CreateIndex
CREATE INDEX "bid_proposal_lines_version_id_idx" ON "bid_proposal_lines"("version_id");

-- CreateIndex
CREATE INDEX "bid_submission_recipients_submission_id_idx" ON "bid_submission_recipients"("submission_id");

-- CreateIndex
CREATE INDEX "bid_follow_up_actions_status_due_at_idx" ON "bid_follow_up_actions"("status", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "bid_follow_up_actions_bid_invitation_id_slot_key_key" ON "bid_follow_up_actions"("bid_invitation_id", "slot_key");

-- CreateIndex
CREATE INDEX "bid_messages_bid_invitation_id_status_idx" ON "bid_messages"("bid_invitation_id", "status");

-- CreateIndex
CREATE INDEX "bid_messages_status_idx" ON "bid_messages"("status");

-- CreateIndex
CREATE UNIQUE INDEX "bid_email_templates_key_key" ON "bid_email_templates"("key");

-- CreateIndex
CREATE UNIQUE INDEX "business_holidays_day_key" ON "business_holidays"("day");

-- CreateIndex
CREATE INDEX "communications_bid_invitation_id_idx" ON "communications"("bid_invitation_id");

-- CreateIndex
CREATE INDEX "files_bid_project_id_idx" ON "files"("bid_project_id");

-- CreateIndex
CREATE INDEX "files_sha256_idx" ON "files"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_source_bid_award_id_key" ON "jobs"("source_bid_award_id");

-- CreateIndex
CREATE INDEX "interactions_bid_invitation_id_idx" ON "interactions"("bid_invitation_id");

-- CreateIndex
CREATE INDEX "bid_invitations_bid_project_id_idx" ON "bid_invitations"("bid_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "bid_invitations_bid_project_id_organization_id_key" ON "bid_invitations"("bid_project_id", "organization_id");

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_bid_project_id_fkey" FOREIGN KEY ("bid_project_id") REFERENCES "bid_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_bid_award_id_fkey" FOREIGN KEY ("source_bid_award_id") REFERENCES "bid_awards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_bid_project_id_fkey" FOREIGN KEY ("bid_project_id") REFERENCES "bid_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_pm_user_id_fkey" FOREIGN KEY ("pm_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_invitations" ADD CONSTRAINT "bid_invitations_purchasing_contact_id_fkey" FOREIGN KEY ("purchasing_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_proposal_version_id_fkey" FOREIGN KEY ("proposal_version_id") REFERENCES "bid_proposal_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submissions" ADD CONSTRAINT "bid_submissions_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_projects" ADD CONSTRAINT "bid_projects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_projects" ADD CONSTRAINT "bid_projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_project_scopes" ADD CONSTRAINT "bid_project_scopes_bid_project_id_fkey" FOREIGN KEY ("bid_project_id") REFERENCES "bid_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_project_scopes" ADD CONSTRAINT "bid_project_scopes_service_category_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_opportunity_scopes" ADD CONSTRAINT "bid_opportunity_scopes_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_opportunity_scopes" ADD CONSTRAINT "bid_opportunity_scopes_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "bid_project_scopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_opportunity_scopes" ADD CONSTRAINT "bid_opportunity_scopes_award_id_fkey" FOREIGN KEY ("award_id") REFERENCES "bid_awards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_proposals" ADD CONSTRAINT "bid_proposals_bid_project_id_fkey" FOREIGN KEY ("bid_project_id") REFERENCES "bid_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_proposal_versions" ADD CONSTRAINT "bid_proposal_versions_bid_proposal_id_fkey" FOREIGN KEY ("bid_proposal_id") REFERENCES "bid_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_proposal_versions" ADD CONSTRAINT "bid_proposal_versions_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_proposal_versions" ADD CONSTRAINT "bid_proposal_versions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_proposal_lines" ADD CONSTRAINT "bid_proposal_lines_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "bid_proposal_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_proposal_lines" ADD CONSTRAINT "bid_proposal_lines_scope_id_fkey" FOREIGN KEY ("scope_id") REFERENCES "bid_project_scopes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submission_recipients" ADD CONSTRAINT "bid_submission_recipients_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "bid_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_submission_recipients" ADD CONSTRAINT "bid_submission_recipients_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_follow_up_actions" ADD CONSTRAINT "bid_follow_up_actions_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_follow_up_actions" ADD CONSTRAINT "bid_follow_up_actions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "bid_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_messages" ADD CONSTRAINT "bid_messages_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: project numbers, one project per PlanHub reference, positive versions.
CREATE SEQUENCE IF NOT EXISTS "bid_project_number_seq" START 1;
CREATE UNIQUE INDEX "bid_projects_source_platform_ref_key" ON "bid_projects"("source", "platform_ref") WHERE "platform_ref" IS NOT NULL;
ALTER TABLE "bid_proposal_versions" ADD CONSTRAINT "bid_proposal_versions_version_chk" CHECK ("version" >= 1);
ALTER TABLE "bid_awards" ADD CONSTRAINT "bid_awards_amount_chk" CHECK ("amount" >= 0);
