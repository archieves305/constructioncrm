-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'PROGRESS', 'FINAL', 'FINANCING_FUNDING');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'RECEIVED', 'OVERDUE', 'WAIVED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "FinancingStatus" AS ENUM ('NOT_NEEDED', 'PENDING_APPLICATION', 'SUBMITTED', 'APPROVED', 'DENIED', 'FUNDED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'PARTIAL', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'SENT', 'COMPLETED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'JOB_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'JOB_STAGE_CHANGE';
ALTER TYPE "ActivityType" ADD VALUE 'PAYMENT_RECEIVED';
ALTER TYPE "ActivityType" ADD VALUE 'CREW_ASSIGNED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_SCHEDULED';
ALTER TYPE "ActivityType" ADD VALUE 'INSPECTION_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'REVIEW_REQUESTED';
ALTER TYPE "ActivityType" ADD VALUE 'REFERRAL_CREATED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "job_id" TEXT;

-- CreateTable
CREATE TABLE "job_stages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stage_order" INTEGER NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "job_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "service_type" TEXT NOT NULL,
    "contract_amount" DECIMAL(12,2) NOT NULL,
    "deposit_required" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deposit_received" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deposit_received_date" TIMESTAMP(3),
    "financing_required" BOOLEAN NOT NULL DEFAULT false,
    "financing_provider" TEXT,
    "financing_status" "FinancingStatus" NOT NULL DEFAULT 'NOT_NEEDED',
    "financing_approved_date" TIMESTAMP(3),
    "balance_due" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "final_payment_received" BOOLEAN NOT NULL DEFAULT false,
    "final_payment_date" TIMESTAMP(3),
    "project_manager_id" TEXT,
    "sales_rep_id" TEXT,
    "current_stage_id" TEXT NOT NULL,
    "next_action" TEXT,
    "target_start_date" TIMESTAMP(3),
    "scheduled_date" TIMESTAMP(3),
    "completion_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_stage_history" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "from_stage_id" TEXT,
    "to_stage_id" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "job_stage_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_permits" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "municipality" TEXT NOT NULL,
    "permit_type" TEXT,
    "permit_number" TEXT,
    "submitted_date" TIMESTAMP(3),
    "approved_date" TIMESTAMP(3),
    "status" "PermitStatus" NOT NULL DEFAULT 'APPLIED',
    "assigned_user_id" TEXT,
    "notes" TEXT,
    "final_passed_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crews" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trade_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crew_assignments" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "crew_id" TEXT NOT NULL,
    "assigned_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "install_date" TIMESTAMP(3),

    CONSTRAINT "crew_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "scheduled_date" TIMESTAMP(3),
    "result" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "inspector_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" TIMESTAMP(3),
    "received_date" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_requests" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'Google',
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "review_url" TEXT,
    "rating" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "referred_by_lead_id" TEXT NOT NULL,
    "referred_name" TEXT NOT NULL,
    "referred_phone" TEXT,
    "referred_email" TEXT,
    "status" "ReferralStatus" NOT NULL DEFAULT 'NEW',
    "converted_lead_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_sessions" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT,
    "job_id" TEXT,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "handed_off" BOOLEAN NOT NULL DEFAULT false,
    "handoff_reason" TEXT,
    "messages_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_stages_name_key" ON "job_stages"("name");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_job_number_key" ON "jobs"("job_number");

-- CreateIndex
CREATE INDEX "jobs_lead_id_idx" ON "jobs"("lead_id");

-- CreateIndex
CREATE INDEX "jobs_current_stage_id_idx" ON "jobs"("current_stage_id");

-- CreateIndex
CREATE INDEX "jobs_sales_rep_id_idx" ON "jobs"("sales_rep_id");

-- CreateIndex
CREATE INDEX "jobs_project_manager_id_idx" ON "jobs"("project_manager_id");

-- CreateIndex
CREATE INDEX "jobs_scheduled_date_idx" ON "jobs"("scheduled_date");

-- CreateIndex
CREATE INDEX "job_stage_history_job_id_idx" ON "job_stage_history"("job_id");

-- CreateIndex
CREATE INDEX "job_permits_job_id_idx" ON "job_permits"("job_id");

-- CreateIndex
CREATE INDEX "job_permits_status_idx" ON "job_permits"("status");

-- CreateIndex
CREATE INDEX "crew_assignments_job_id_idx" ON "crew_assignments"("job_id");

-- CreateIndex
CREATE INDEX "crew_assignments_crew_id_idx" ON "crew_assignments"("crew_id");

-- CreateIndex
CREATE INDEX "inspections_job_id_idx" ON "inspections"("job_id");

-- CreateIndex
CREATE INDEX "payments_job_id_idx" ON "payments"("job_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "review_requests_job_id_idx" ON "review_requests"("job_id");

-- CreateIndex
CREATE INDEX "referrals_job_id_idx" ON "referrals"("job_id");

-- CreateIndex
CREATE INDEX "ai_sessions_lead_id_idx" ON "ai_sessions"("lead_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_current_stage_id_fkey" FOREIGN KEY ("current_stage_id") REFERENCES "job_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_project_manager_id_fkey" FOREIGN KEY ("project_manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_sales_rep_id_fkey" FOREIGN KEY ("sales_rep_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stage_history" ADD CONSTRAINT "job_stage_history_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stage_history" ADD CONSTRAINT "job_stage_history_from_stage_id_fkey" FOREIGN KEY ("from_stage_id") REFERENCES "job_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stage_history" ADD CONSTRAINT "job_stage_history_to_stage_id_fkey" FOREIGN KEY ("to_stage_id") REFERENCES "job_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_stage_history" ADD CONSTRAINT "job_stage_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_permits" ADD CONSTRAINT "job_permits_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_permits" ADD CONSTRAINT "job_permits_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crew_assignments" ADD CONSTRAINT "crew_assignments_crew_id_fkey" FOREIGN KEY ("crew_id") REFERENCES "crews"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_fkey" FOREIGN KEY ("inspector_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_by_lead_id_fkey" FOREIGN KEY ("referred_by_lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
