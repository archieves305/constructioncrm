-- CreateEnum
CREATE TYPE "PlanAiCallStatus" AS ENUM ('OK', 'FAILED');

-- AlterTable
ALTER TABLE "plan_jobs" ADD COLUMN     "takeoff_id" TEXT;

-- CreateTable
CREATE TABLE "plan_ai_calls" (
    "id" TEXT NOT NULL,
    "takeoff_id" TEXT NOT NULL,
    "plan_sheet_id" TEXT,
    "purpose" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_hash" TEXT NOT NULL,
    "status" "PlanAiCallStatus" NOT NULL DEFAULT 'OK',
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
    "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB,
    "error" TEXT,
    "requested_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "plan_ai_calls_takeoff_id_purpose_input_hash_idx" ON "plan_ai_calls"("takeoff_id", "purpose", "input_hash");

-- CreateIndex
CREATE INDEX "plan_jobs_takeoff_id_idx" ON "plan_jobs"("takeoff_id");

-- AddForeignKey
ALTER TABLE "plan_jobs" ADD CONSTRAINT "plan_jobs_takeoff_id_fkey" FOREIGN KEY ("takeoff_id") REFERENCES "takeoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ai_calls" ADD CONSTRAINT "plan_ai_calls_takeoff_id_fkey" FOREIGN KEY ("takeoff_id") REFERENCES "takeoffs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ai_calls" ADD CONSTRAINT "plan_ai_calls_plan_sheet_id_fkey" FOREIGN KEY ("plan_sheet_id") REFERENCES "plan_sheets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_ai_calls" ADD CONSTRAINT "plan_ai_calls_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- hand-written: a call never costs a negative amount
ALTER TABLE "plan_ai_calls" ADD CONSTRAINT "plan_ai_calls_cost_chk" CHECK ("cost_usd" >= 0);
