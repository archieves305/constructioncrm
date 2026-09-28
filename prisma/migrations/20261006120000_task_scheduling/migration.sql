-- CreateEnum
CREATE TYPE "CalendarView" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- AlterEnum
ALTER TYPE "TaskEventType" ADD VALUE 'SCHEDULE_CHANGED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "all_day" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "scheduled_start" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_calendar_view" "CalendarView" NOT NULL DEFAULT 'WEEK';

-- CreateIndex
CREATE INDEX "tasks_assigned_user_id_due_at_idx" ON "tasks"("assigned_user_id", "due_at");


-- Hand-added: the scheduling window invariant (see src/lib/calendar/schedule.ts).
-- A window needs a due date and ends at it; a timed item has a real start
-- strictly before its end. Every pre-calendar row (start NULL, all_day TRUE)
-- satisfies it, so there is no backfill.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_schedule_window_chk" CHECK (
  ("scheduled_start" IS NULL OR ("due_at" IS NOT NULL AND "scheduled_start" <= "due_at"))
  AND ("all_day" OR ("scheduled_start" IS NOT NULL AND "due_at" IS NOT NULL AND "scheduled_start" < "due_at"))
);
