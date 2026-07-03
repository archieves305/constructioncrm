-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "daily_report_recipients" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "labor_settings" ADD COLUMN     "payroll_approved_only" BOOLEAN NOT NULL DEFAULT false;

