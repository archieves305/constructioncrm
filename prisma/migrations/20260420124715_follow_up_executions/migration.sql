-- CreateEnum
CREATE TYPE "FollowUpExecutionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "follow_up_executions" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "executed_at" TIMESTAMP(3),
    "status" "FollowUpExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "follow_up_executions_status_scheduled_at_idx" ON "follow_up_executions"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "follow_up_executions_lead_id_idx" ON "follow_up_executions"("lead_id");

-- CreateIndex
CREATE INDEX "follow_up_rules_trigger_event_is_active_idx" ON "follow_up_rules"("trigger_event", "is_active");

-- AddForeignKey
ALTER TABLE "follow_up_executions" ADD CONSTRAINT "follow_up_executions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "follow_up_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_executions" ADD CONSTRAINT "follow_up_executions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
