-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskEventType" ADD VALUE 'NUDGED';
ALTER TYPE "TaskEventType" ADD VALUE 'ESCALATED';
ALTER TYPE "TaskEventType" ADD VALUE 'REMINDER_SET';
ALTER TYPE "TaskEventType" ADD VALUE 'REMINDER_SENT';
ALTER TYPE "TaskEventType" ADD VALUE 'AUTO_CLOSED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "escalation_level" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "last_escalated_at" TIMESTAMP(3),
ADD COLUMN     "remind_at" TIMESTAMP(3),
ADD COLUMN     "remind_set_by_user_id" TEXT,
ADD COLUMN     "reminded_at" TIMESTAMP(3),
ADD COLUMN     "source_key" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "escalation_emails_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "nudge_emails_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminder_digest_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "tasks_source_key_idx" ON "tasks"("source_key");

-- CreateIndex
CREATE INDEX "tasks_remind_at_idx" ON "tasks"("remind_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_remind_set_by_user_id_fkey" FOREIGN KEY ("remind_set_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

