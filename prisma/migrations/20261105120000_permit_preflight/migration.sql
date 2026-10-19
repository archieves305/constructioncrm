-- Permit Intelligence, Stage 5: preflight runs, and the permit's "ready to
-- submit" mark (with an override's reason).

-- AlterTable
ALTER TABLE "job_permits" ADD COLUMN     "ready_at" TIMESTAMP(3),
ADD COLUMN     "ready_by_user_id" TEXT,
ADD COLUMN     "ready_override" TEXT,
ADD COLUMN     "ready_run_id" TEXT;

-- CreateTable
CREATE TABLE "permit_preflight_runs" (
    "id" TEXT NOT NULL,
    "permit_id" TEXT NOT NULL,
    "cycle_number" INTEGER NOT NULL,
    "rules_version" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "blockers" INTEGER NOT NULL,
    "warnings" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,
    "ai_call_id" TEXT,
    "ran_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permit_preflight_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permit_preflight_runs_permit_id_created_at_idx" ON "permit_preflight_runs"("permit_id", "created_at");

-- AddForeignKey
ALTER TABLE "job_permits" ADD CONSTRAINT "job_permits_ready_by_user_id_fkey" FOREIGN KEY ("ready_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_preflight_runs" ADD CONSTRAINT "permit_preflight_runs_permit_id_fkey" FOREIGN KEY ("permit_id") REFERENCES "job_permits"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permit_preflight_runs" ADD CONSTRAINT "permit_preflight_runs_ran_by_user_id_fkey" FOREIGN KEY ("ran_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
