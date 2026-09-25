-- Code Violations module: engine generalisation + case models.
--
-- Generated with `prisma migrate diff`, PLUS two hand-written statements at
-- the END of this file that Prisma cannot model: the one-subject CHECK on
-- job_workflow_instances and the case-number SEQUENCE. If this file is ever
-- regenerated, re-append them. No transaction wrapper: the ALTER TYPE …
-- ADD VALUE statements only add values and nothing here references them.

-- CreateEnum
CREATE TYPE "CodeViolationStatus" AS ENUM ('NEW', 'ACTIVE', 'ON_HOLD', 'APPEALED', 'COMPLIED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CodeViolationSeverity" AS ENUM ('LOW', 'MODERATE', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CodeViolationItemStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CORRECTED', 'VERIFIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CodeViolationHearingType" AS ENUM ('SPECIAL_MAGISTRATE', 'CODE_ENFORCEMENT_BOARD', 'APPEAL', 'LIEN_REDUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "CodeViolationHearingStatus" AS ENUM ('SCHEDULED', 'CONTINUED', 'HELD', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CodeViolationHearingOutcome" AS ENUM ('COMPLIANCE_ORDERED', 'FINE_IMPOSED', 'CONTINUED', 'DISMISSED', 'FOUND_IN_COMPLIANCE', 'LIEN_AUTHORIZED', 'MITIGATION_GRANTED', 'MITIGATION_DENIED', 'OTHER');

-- CreateEnum
CREATE TYPE "CodeViolationInspectionStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CodeViolationExtensionStatus" AS ENUM ('REQUESTED', 'GRANTED', 'DENIED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CodeViolationMitigationStatus" AS ENUM ('NONE', 'REQUESTED', 'GRANTED', 'PARTIALLY_GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "CodeViolationLienStatus" AS ENUM ('NONE', 'RECORDED', 'RELEASED');

-- CreateEnum
CREATE TYPE "CodeViolationFineEntryType" AS ENUM ('OFFICIAL_BALANCE', 'ACCRUAL_STARTED', 'ACCRUAL_STOPPED', 'FINE_IMPOSED', 'ADMIN_COST', 'PAYMENT', 'MITIGATION_REQUESTED', 'MITIGATION_DECIDED', 'LIEN_RECORDED', 'LIEN_RELEASED', 'ADJUSTMENT', 'NOTE');

-- CreateEnum
CREATE TYPE "CodeViolationEventType" AS ENUM ('NOTE', 'CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'DEADLINE_CHANGED', 'EXTENSION_REQUESTED', 'EXTENSION_DECIDED', 'HEARING_SCHEDULED', 'HEARING_RESULT', 'INSPECTION_REQUESTED', 'INSPECTION_RESULT', 'ITEM_ADDED', 'ITEM_STATUS_CHANGED', 'FINE_ENTRY', 'LIEN_RECORDED', 'LIEN_RELEASED', 'AGENCY_CONFIRMED', 'CORRECTIVE_WORK_COMPLETED', 'JOB_LINKED', 'JOB_UNLINKED', 'WORKFLOW_APPLIED', 'CLOSED', 'REOPENED', 'FILE_ATTACHED', 'COMMUNICATION_LOGGED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowAnchor" ADD VALUE 'COMPLIANCE_DEADLINE';
ALTER TYPE "WorkflowAnchor" ADD VALUE 'HEARING_DATE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkflowEvidenceType" ADD VALUE 'AGENCY_CONFIRMATION';
ALTER TYPE "WorkflowEvidenceType" ADD VALUE 'HEARING_RESULT';
ALTER TYPE "WorkflowEvidenceType" ADD VALUE 'FINE_STATUS';
ALTER TYPE "WorkflowEvidenceType" ADD VALUE 'VIOLATION_ITEMS';
ALTER TYPE "WorkflowEvidenceType" ADD VALUE 'LINKED_JOB';
ALTER TYPE "WorkflowEvidenceType" ADD VALUE 'LINKED_JOB_PERMIT';

-- AlterEnum
ALTER TYPE "WorkflowRole" ADD VALUE 'CASE_MANAGER';

-- AlterEnum
ALTER TYPE "WorkflowTemplateKind" ADD VALUE 'VIOLATION';

-- AlterTable
ALTER TABLE "communications" ADD COLUMN     "violation_case_id" TEXT;

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "violation_case_id" TEXT,
ADD COLUMN     "violation_item_id" TEXT;

-- AlterTable
ALTER TABLE "job_workflow_instances" ADD COLUMN     "violation_case_id" TEXT,
ALTER COLUMN "job_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "violation_case_id" TEXT,
ADD COLUMN     "violation_item_id" TEXT;

-- CreateTable
CREATE TABLE "code_violation_categories" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_responsible_trade" TEXT,
    "default_permit_requirement" "WorkflowPermitStatus" NOT NULL DEFAULT 'UNDETERMINED',
    "default_construction_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_violation_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_cases" (
    "id" TEXT NOT NULL,
    "case_number" TEXT NOT NULL,
    "agency_case_number" TEXT,
    "lead_id" TEXT NOT NULL,
    "job_id" TEXT,
    "parcel_number" TEXT,
    "owner_name_snapshot" TEXT,
    "jurisdiction" TEXT,
    "department" TEXT,
    "officer_name" TEXT,
    "officer_phone" TEXT,
    "officer_email" TEXT,
    "notice_type" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL,
    "notice_date" TIMESTAMP(3),
    "original_deadline" TIMESTAMP(3),
    "current_deadline" TIMESTAMP(3),
    "next_hearing_at" TIMESTAMP(3),
    "appeal_deadline" TIMESTAMP(3),
    "status" "CodeViolationStatus" NOT NULL DEFAULT 'NEW',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "severity" "CodeViolationSeverity" NOT NULL DEFAULT 'MODERATE',
    "case_manager_id" TEXT,
    "responsible_role" "WorkflowRole",
    "hearing_required" BOOLEAN NOT NULL DEFAULT false,
    "reinspection_required" BOOLEAN NOT NULL DEFAULT true,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "construction_required" BOOLEAN NOT NULL DEFAULT false,
    "extension_status" "CodeViolationExtensionStatus",
    "extension_requested_at" TIMESTAMP(3),
    "extension_deadline" TIMESTAMP(3),
    "estimated_cost" DECIMAL(12,2),
    "actual_cost" DECIMAL(12,2),
    "initial_fine" DECIMAL(12,2),
    "daily_fine" DECIMAL(12,2),
    "fine_accrual_start_date" TIMESTAMP(3),
    "fine_accrual_stopped_at" TIMESTAMP(3),
    "admin_costs" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "official_balance" DECIMAL(12,2),
    "official_balance_as_of" TIMESTAMP(3),
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "mitigation_status" "CodeViolationMitigationStatus" NOT NULL DEFAULT 'NONE',
    "mitigation_requested_amount" DECIMAL(12,2),
    "mitigation_granted_amount" DECIMAL(12,2),
    "mitigation_requested_at" TIMESTAMP(3),
    "mitigation_decided_at" TIMESTAMP(3),
    "fine_estimate_override" DECIMAL(12,2),
    "fine_estimate_override_reason" TEXT,
    "fine_estimate_override_at" TIMESTAMP(3),
    "fine_terms_updated_at" TIMESTAMP(3),
    "lien_status" "CodeViolationLienStatus" NOT NULL DEFAULT 'NONE',
    "lien_amount" DECIMAL(12,2),
    "lien_recorded_at" TIMESTAMP(3),
    "lien_instrument_number" TEXT,
    "lien_book_page" TEXT,
    "lien_released_at" TIMESTAMP(3),
    "lien_release_instrument_number" TEXT,
    "corrective_work_completed_at" TIMESTAMP(3),
    "reinspection_requested_at" TIMESTAMP(3),
    "final_inspection_result" "PermitInspectionResult",
    "agency_confirmed_at" TIMESTAMP(3),
    "agency_confirmed_by_name" TEXT,
    "agency_confirmation_method" TEXT,
    "agency_confirmation_ref" TEXT,
    "agency_confirmation_file_id" TEXT,
    "official_compliance_date" TIMESTAMP(3),
    "permit_closed_at" TIMESTAMP(3),
    "fine_resolved_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "closed_by_user_id" TEXT,
    "close_reason" TEXT,
    "closure_override_reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_violation_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_items" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "item_number" INTEGER NOT NULL,
    "category_id" TEXT,
    "code_section" TEXT,
    "description" TEXT NOT NULL,
    "corrective_action" TEXT,
    "responsible_trade" TEXT,
    "permit_requirement" "WorkflowPermitStatus" NOT NULL DEFAULT 'UNDETERMINED',
    "assigned_user_id" TEXT,
    "assigned_role" "WorkflowRole",
    "contractor_name" TEXT,
    "status" "CodeViolationItemStatus" NOT NULL DEFAULT 'OPEN',
    "target_completion_at" TIMESTAMP(3),
    "actual_completion_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "estimated_cost" DECIMAL(12,2),
    "actual_cost" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_violation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_hearings" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "type" "CodeViolationHearingType" NOT NULL DEFAULT 'SPECIAL_MAGISTRATE',
    "status" "CodeViolationHearingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "attendee_user_id" TEXT,
    "case_number_at_hearing" TEXT,
    "outcome" "CodeViolationHearingOutcome",
    "outcome_notes" TEXT,
    "order_deadline" TIMESTAMP(3),
    "ordered_fine_amount" DECIMAL(12,2),
    "ordered_daily_fine" DECIMAL(12,2),
    "continued_to_id" TEXT,
    "order_file_id" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_violation_hearings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_inspections" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'REINSPECTION',
    "status" "CodeViolationInspectionStatus" NOT NULL DEFAULT 'REQUESTED',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by_user_id" TEXT,
    "scheduled_for" TIMESTAMP(3),
    "attendee_user_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "result" "PermitInspectionResult",
    "inspector_name" TEXT,
    "notes" TEXT,
    "failed_item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "report_file_id" TEXT,
    "task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_violation_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_extensions" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_deadline" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "CodeViolationExtensionStatus" NOT NULL DEFAULT 'REQUESTED',
    "decided_at" TIMESTAMP(3),
    "granted_deadline" TIMESTAMP(3),
    "decision_notes" TEXT,
    "request_file_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_violation_extensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_fine_entries" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "type" "CodeViolationFineEntryType" NOT NULL,
    "amount" DECIMAL(12,2),
    "effective_at" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "file_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_violation_fine_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_events" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "item_id" TEXT,
    "actor_user_id" TEXT,
    "type" "CodeViolationEventType" NOT NULL,
    "body" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_violation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "code_violation_reminder_logs" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "offset_key" TEXT NOT NULL,
    "recipient_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel" TEXT NOT NULL DEFAULT 'email',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "code_violation_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "code_violation_categories_key_key" ON "code_violation_categories"("key");

-- CreateIndex
CREATE UNIQUE INDEX "code_violation_cases_case_number_key" ON "code_violation_cases"("case_number");

-- CreateIndex
CREATE INDEX "code_violation_cases_lead_id_idx" ON "code_violation_cases"("lead_id");

-- CreateIndex
CREATE INDEX "code_violation_cases_job_id_idx" ON "code_violation_cases"("job_id");

-- CreateIndex
CREATE INDEX "code_violation_cases_status_idx" ON "code_violation_cases"("status");

-- CreateIndex
CREATE INDEX "code_violation_cases_case_manager_id_status_idx" ON "code_violation_cases"("case_manager_id", "status");

-- CreateIndex
CREATE INDEX "code_violation_cases_current_deadline_idx" ON "code_violation_cases"("current_deadline");

-- CreateIndex
CREATE INDEX "code_violation_cases_next_hearing_at_idx" ON "code_violation_cases"("next_hearing_at");

-- CreateIndex
CREATE INDEX "code_violation_cases_agency_case_number_idx" ON "code_violation_cases"("agency_case_number");

-- CreateIndex
CREATE INDEX "code_violation_cases_jurisdiction_idx" ON "code_violation_cases"("jurisdiction");

-- CreateIndex
CREATE INDEX "code_violation_items_case_id_status_idx" ON "code_violation_items"("case_id", "status");

-- CreateIndex
CREATE INDEX "code_violation_items_assigned_user_id_status_idx" ON "code_violation_items"("assigned_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "code_violation_items_case_id_item_number_key" ON "code_violation_items"("case_id", "item_number");

-- CreateIndex
CREATE UNIQUE INDEX "code_violation_hearings_continued_to_id_key" ON "code_violation_hearings"("continued_to_id");

-- CreateIndex
CREATE INDEX "code_violation_hearings_case_id_scheduled_at_idx" ON "code_violation_hearings"("case_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "code_violation_hearings_scheduled_at_idx" ON "code_violation_hearings"("scheduled_at");

-- CreateIndex
CREATE INDEX "code_violation_inspections_case_id_requested_at_idx" ON "code_violation_inspections"("case_id", "requested_at");

-- CreateIndex
CREATE INDEX "code_violation_inspections_scheduled_for_idx" ON "code_violation_inspections"("scheduled_for");

-- CreateIndex
CREATE INDEX "code_violation_extensions_case_id_idx" ON "code_violation_extensions"("case_id");

-- CreateIndex
CREATE INDEX "code_violation_fine_entries_case_id_effective_at_idx" ON "code_violation_fine_entries"("case_id", "effective_at");

-- CreateIndex
CREATE INDEX "code_violation_events_case_id_created_at_idx" ON "code_violation_events"("case_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "code_violation_reminder_logs_case_id_kind_entity_id_offset__key" ON "code_violation_reminder_logs"("case_id", "kind", "entity_id", "offset_key");

-- CreateIndex
CREATE INDEX "communications_violation_case_id_idx" ON "communications"("violation_case_id");

-- CreateIndex
CREATE INDEX "files_violation_case_id_idx" ON "files"("violation_case_id");

-- CreateIndex
CREATE INDEX "files_violation_item_id_idx" ON "files"("violation_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_workflow_instances_violation_case_id_key" ON "job_workflow_instances"("violation_case_id");

-- CreateIndex
CREATE INDEX "tasks_violation_case_id_idx" ON "tasks"("violation_case_id");

-- CreateIndex
CREATE INDEX "tasks_violation_item_id_idx" ON "tasks"("violation_item_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_violation_case_id_fkey" FOREIGN KEY ("violation_case_id") REFERENCES "code_violation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_violation_item_id_fkey" FOREIGN KEY ("violation_item_id") REFERENCES "code_violation_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communications" ADD CONSTRAINT "communications_violation_case_id_fkey" FOREIGN KEY ("violation_case_id") REFERENCES "code_violation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_violation_case_id_fkey" FOREIGN KEY ("violation_case_id") REFERENCES "code_violation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_violation_item_id_fkey" FOREIGN KEY ("violation_item_id") REFERENCES "code_violation_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_instances" ADD CONSTRAINT "job_workflow_instances_violation_case_id_fkey" FOREIGN KEY ("violation_case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_cases" ADD CONSTRAINT "code_violation_cases_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_cases" ADD CONSTRAINT "code_violation_cases_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_cases" ADD CONSTRAINT "code_violation_cases_case_manager_id_fkey" FOREIGN KEY ("case_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_cases" ADD CONSTRAINT "code_violation_cases_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_cases" ADD CONSTRAINT "code_violation_cases_closed_by_user_id_fkey" FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_items" ADD CONSTRAINT "code_violation_items_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_items" ADD CONSTRAINT "code_violation_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "code_violation_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_items" ADD CONSTRAINT "code_violation_items_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_hearings" ADD CONSTRAINT "code_violation_hearings_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_hearings" ADD CONSTRAINT "code_violation_hearings_attendee_user_id_fkey" FOREIGN KEY ("attendee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_hearings" ADD CONSTRAINT "code_violation_hearings_continued_to_id_fkey" FOREIGN KEY ("continued_to_id") REFERENCES "code_violation_hearings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_inspections" ADD CONSTRAINT "code_violation_inspections_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_inspections" ADD CONSTRAINT "code_violation_inspections_attendee_user_id_fkey" FOREIGN KEY ("attendee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_extensions" ADD CONSTRAINT "code_violation_extensions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_fine_entries" ADD CONSTRAINT "code_violation_fine_entries_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_events" ADD CONSTRAINT "code_violation_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_events" ADD CONSTRAINT "code_violation_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "code_violation_reminder_logs" ADD CONSTRAINT "code_violation_reminder_logs_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-written (not modelled by Prisma) ─────────────────────────────────

-- A workflow instance belongs to exactly one subject: a job OR a violation case.
ALTER TABLE "job_workflow_instances" ADD CONSTRAINT "job_workflow_instances_one_subject" CHECK (("job_id" IS NULL) <> ("violation_case_id" IS NULL));

-- Case numbers ("CV-00001") come from a sequence read inside the create
-- transaction, so two processes can never issue the same number.
CREATE SEQUENCE "code_violation_case_number_seq" START 1;
