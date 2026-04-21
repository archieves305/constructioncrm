-- CreateEnum
CREATE TYPE "BuildiumSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED');

-- AlterTable jobs
ALTER TABLE "jobs" ADD COLUMN "is_rental_turnover" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "jobs" ADD COLUMN "buildium_property_id" TEXT;
ALTER TABLE "jobs" ADD COLUMN "buildium_unit_id" TEXT;
ALTER TABLE "jobs" ADD COLUMN "prior_tenant_name" TEXT;
ALTER TABLE "jobs" ADD COLUMN "turnover_started_at" TIMESTAMP(3);
ALTER TABLE "jobs" ADD COLUMN "turnover_completed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "jobs_is_rental_turnover_idx" ON "jobs"("is_rental_turnover");
CREATE INDEX "jobs_buildium_property_id_idx" ON "jobs"("buildium_property_id");

-- AlterTable job_expenses
ALTER TABLE "job_expenses" ADD COLUMN "buildium_bill_id" TEXT;
ALTER TABLE "job_expenses" ADD COLUMN "buildium_sync_status" "BuildiumSyncStatus";
ALTER TABLE "job_expenses" ADD COLUMN "buildium_sync_error" TEXT;
ALTER TABLE "job_expenses" ADD COLUMN "buildium_synced_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "job_expenses_buildium_sync_status_idx" ON "job_expenses"("buildium_sync_status");

-- CreateTable buildium_settings
CREATE TABLE "buildium_settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buildium_settings_pkey" PRIMARY KEY ("key")
);
