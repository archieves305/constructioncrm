-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('FIXED_PRICE', 'COST_PLUS');

-- CreateEnum
CREATE TYPE "MarginType" AS ENUM ('PERCENT', 'FLAT');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN "job_type" "JobType" NOT NULL DEFAULT 'FIXED_PRICE';
ALTER TABLE "jobs" ADD COLUMN "labor_cost" DECIMAL(12,2);
ALTER TABLE "jobs" ADD COLUMN "margin_type" "MarginType";
ALTER TABLE "jobs" ADD COLUMN "margin_value" DECIMAL(12,2);
