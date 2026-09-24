-- CreateEnum
CREATE TYPE "WorkflowTemplateKind" AS ENUM ('CORE', 'TRADE');

-- CreateEnum
CREATE TYPE "WorkflowVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowRole" AS ENUM ('PROJECT_MANAGER', 'SALES_REP', 'SUPERINTENDENT', 'PERMIT_COORDINATOR', 'ESTIMATOR', 'OFFICE_ADMIN', 'PURCHASING', 'ACCOUNTING', 'QUALITY_CONTROL');

-- CreateEnum
CREATE TYPE "WorkflowAnchor" AS ENUM ('JOB_CREATED', 'APPLIED_AT', 'TARGET_START', 'PHASE_START', 'PREDECESSOR');

-- CreateEnum
CREATE TYPE "WorkflowEvidenceType" AS ENUM ('ATTACHMENT', 'PHOTO', 'PERMIT_NUMBER', 'PERMIT_DETERMINATION', 'INSPECTION_RESULT', 'PAYMENT_STATUS', 'NOTE');

-- CreateEnum
CREATE TYPE "WorkflowPermitCondition" AS ENUM ('REQUIRED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "WorkflowPermitStatus" AS ENUM ('UNDETERMINED', 'REQUIRED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "JobWorkflowStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskDependencyKind" AS ENUM ('BLOCKING', 'DATE_ONLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskEventType" ADD VALUE 'ACTIVATED';
ALTER TYPE "TaskEventType" ADD VALUE 'SKIPPED';
ALTER TYPE "TaskEventType" ADD VALUE 'DEPENDENCY_ADDED';
ALTER TYPE "TaskEventType" ADD VALUE 'DEPENDENCY_REMOVED';
ALTER TYPE "TaskEventType" ADD VALUE 'CHECKLIST_UPDATED';
ALTER TYPE "TaskEventType" ADD VALUE 'EVIDENCE_ATTACHED';
ALTER TYPE "TaskEventType" ADD VALUE 'INSPECTION_RESULT';
ALTER TYPE "TaskEventType" ADD VALUE 'RECONCILED';

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "task_id" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "jurisdiction" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "activated_at" TIMESTAMP(3),
ADD COLUMN     "blocking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checklist" JSONB,
ADD COLUMN     "due_locked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "due_offset_business_days" INTEGER,
ADD COLUMN     "inspection_recorded_at" TIMESTAMP(3),
ADD COLUMN     "inspection_result" "PermitInspectionResult",
ADD COLUMN     "required_evidence" "WorkflowEvidenceType",
ADD COLUMN     "required_evidence_param" TEXT,
ADD COLUMN     "skip_reason" TEXT,
ADD COLUMN     "workflow_anchor" "WorkflowAnchor",
ADD COLUMN     "workflow_instance_id" TEXT,
ADD COLUMN     "workflow_module_key" TEXT,
ADD COLUMN     "workflow_phase_key" TEXT,
ADD COLUMN     "workflow_role" "WorkflowRole",
ADD COLUMN     "workflow_sort_order" INTEGER,
ADD COLUMN     "workflow_task_key" TEXT;

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WorkflowTemplateKind" NOT NULL,
    "trade" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_template_service_categories" (
    "template_id" TEXT NOT NULL,
    "service_category_id" TEXT NOT NULL,

    CONSTRAINT "workflow_template_service_categories_pkey" PRIMARY KEY ("template_id","service_category_id")
);

-- CreateTable
CREATE TABLE "workflow_template_versions" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "WorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "change_notes" TEXT,
    "scope_toggles" JSONB NOT NULL DEFAULT '[]',
    "content_hash" TEXT NOT NULL,
    "source_version_id" TEXT,
    "created_by_user_id" TEXT,
    "published_by_user_id" TEXT,
    "published_at" TIMESTAMP(3),
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_phases" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "band" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "note" TEXT,
    "condition_permit" "WorkflowPermitCondition",

    CONSTRAINT "workflow_phases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_task_templates" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "phase_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "role" "WorkflowRole" NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "anchor" "WorkflowAnchor" NOT NULL DEFAULT 'PREDECESSOR',
    "due_offset_business_days" INTEGER NOT NULL DEFAULT 0,
    "duration_business_days" INTEGER,
    "auto_activate" BOOLEAN NOT NULL DEFAULT false,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "required_evidence" "WorkflowEvidenceType",
    "required_evidence_param" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "condition_permit" "WorkflowPermitCondition",
    "condition_any_of" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "condition_all_of" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overrides_core_key" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "workflow_task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_task_dependencies" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "task_key" TEXT NOT NULL,
    "depends_on_ref" TEXT NOT NULL,
    "kind" "TaskDependencyKind" NOT NULL DEFAULT 'BLOCKING',

    CONSTRAINT "workflow_task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_role_defaults" (
    "id" TEXT NOT NULL,
    "role" "WorkflowRole" NOT NULL,
    "user_id" TEXT NOT NULL,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_role_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_workflow_instances" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "status" "JobWorkflowStatus" NOT NULL DEFAULT 'ACTIVE',
    "permit_status" "WorkflowPermitStatus" NOT NULL DEFAULT 'UNDETERMINED',
    "permit_determined_by_user_id" TEXT,
    "permit_determined_at" TIMESTAMP(3),
    "permit_notes" TEXT,
    "permit_document_file_id" TEXT,
    "scope_toggles" JSONB NOT NULL DEFAULT '{}',
    "applied_by_user_id" TEXT NOT NULL,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_workflow_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_workflow_modules" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "template_version_id" TEXT NOT NULL,
    "added_by_user_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMP(3),
    "removed_by_user_id" TEXT,
    "remove_reason" TEXT,

    CONSTRAINT "job_workflow_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_workflow_team_members" (
    "id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "role" "WorkflowRole" NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "job_workflow_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "depends_on_task_id" TEXT NOT NULL,
    "kind" "TaskDependencyKind" NOT NULL DEFAULT 'BLOCKING',
    "source" TEXT NOT NULL DEFAULT 'workflow',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_templates_key_key" ON "workflow_templates"("key");

-- CreateIndex
CREATE INDEX "workflow_template_versions_template_id_status_idx" ON "workflow_template_versions"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_template_versions_template_id_version_key" ON "workflow_template_versions"("template_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_phases_version_id_key_key" ON "workflow_phases"("version_id", "key");

-- CreateIndex
CREATE INDEX "workflow_task_templates_phase_id_idx" ON "workflow_task_templates"("phase_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_task_templates_version_id_key_key" ON "workflow_task_templates"("version_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_task_dependencies_version_id_task_key_depends_on_r_key" ON "workflow_task_dependencies"("version_id", "task_key", "depends_on_ref");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_role_defaults_role_key" ON "workflow_role_defaults"("role");

-- CreateIndex
CREATE UNIQUE INDEX "job_workflow_instances_job_id_key" ON "job_workflow_instances"("job_id");

-- CreateIndex
CREATE INDEX "job_workflow_modules_template_version_id_idx" ON "job_workflow_modules"("template_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_workflow_modules_instance_id_template_key_key" ON "job_workflow_modules"("instance_id", "template_key");

-- CreateIndex
CREATE INDEX "job_workflow_team_members_user_id_idx" ON "job_workflow_team_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_workflow_team_members_instance_id_role_key" ON "job_workflow_team_members"("instance_id", "role");

-- CreateIndex
CREATE INDEX "task_dependencies_depends_on_task_id_idx" ON "task_dependencies"("depends_on_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_task_id_depends_on_task_id_key" ON "task_dependencies"("task_id", "depends_on_task_id");

-- CreateIndex
CREATE INDEX "files_task_id_idx" ON "files"("task_id");

-- CreateIndex
CREATE INDEX "tasks_workflow_instance_id_workflow_phase_key_idx" ON "tasks"("workflow_instance_id", "workflow_phase_key");

-- CreateIndex
CREATE INDEX "tasks_activated_at_idx" ON "tasks"("activated_at");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_workflow_instance_id_workflow_task_key_key" ON "tasks"("workflow_instance_id", "workflow_task_key");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflow_instance_id_fkey" FOREIGN KEY ("workflow_instance_id") REFERENCES "job_workflow_instances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_template_service_categories" ADD CONSTRAINT "workflow_template_service_categories_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_template_service_categories" ADD CONSTRAINT "workflow_template_service_categories_service_category_id_fkey" FOREIGN KEY ("service_category_id") REFERENCES "service_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_template_versions" ADD CONSTRAINT "workflow_template_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_phases" ADD CONSTRAINT "workflow_phases_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "workflow_template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task_templates" ADD CONSTRAINT "workflow_task_templates_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "workflow_template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task_templates" ADD CONSTRAINT "workflow_task_templates_phase_id_fkey" FOREIGN KEY ("phase_id") REFERENCES "workflow_phases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_task_dependencies" ADD CONSTRAINT "workflow_task_dependencies_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "workflow_template_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_role_defaults" ADD CONSTRAINT "workflow_role_defaults_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_instances" ADD CONSTRAINT "job_workflow_instances_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_instances" ADD CONSTRAINT "job_workflow_instances_applied_by_user_id_fkey" FOREIGN KEY ("applied_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_instances" ADD CONSTRAINT "job_workflow_instances_permit_determined_by_user_id_fkey" FOREIGN KEY ("permit_determined_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_modules" ADD CONSTRAINT "job_workflow_modules_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "job_workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_modules" ADD CONSTRAINT "job_workflow_modules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_modules" ADD CONSTRAINT "job_workflow_modules_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "workflow_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_team_members" ADD CONSTRAINT "job_workflow_team_members_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "job_workflow_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_workflow_team_members" ADD CONSTRAINT "job_workflow_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_fkey" FOREIGN KEY ("depends_on_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every pre-workflow task is active. Without this, the new
-- "active open" counts would read zero for all existing work.
UPDATE "tasks" SET "activated_at" = "created_at" WHERE "activated_at" IS NULL;
