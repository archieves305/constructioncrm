-- CreateEnum
CREATE TYPE "TaskEventType" AS ENUM ('NOTE', 'CREATED', 'ASSIGNED', 'UNASSIGNED', 'STATUS_CHANGED', 'PRIORITY_CHANGED', 'DUE_CHANGED', 'BLOCKED', 'UNBLOCKED', 'WATCHER_ADDED', 'WATCHER_REMOVED', 'EMAIL_SENT', 'EMAIL_FAILED');

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE 'BLOCKED';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "completed_by_user_id" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "task_emails_enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "task_events" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "type" "TaskEventType" NOT NULL,
    "body" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_watchers" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_watchers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_events_task_id_created_at_idx" ON "task_events"("task_id", "created_at");

-- CreateIndex
CREATE INDEX "task_watchers_user_id_idx" ON "task_watchers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_watchers_task_id_user_id_key" ON "task_watchers"("task_id", "user_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_user_id_fkey" FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_events" ADD CONSTRAINT "task_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_watchers" ADD CONSTRAINT "task_watchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: approximate assigned_at for tasks that already have an assignee.
-- created_at is exact for the common case (assigned at creation) and a
-- lower bound otherwise; leaving it NULL would render as "never assigned".
UPDATE "tasks" SET "assigned_at" = "created_at" WHERE "assigned_user_id" IS NOT NULL;

-- Backfill: give every pre-existing task the CREATED event it would have had.
-- Without this an older task opens to an empty timeline, which reads as lost
-- history rather than as history that predates the feature.
INSERT INTO "task_events" ("id", "task_id", "actor_user_id", "type", "created_at")
SELECT
  'seed_' || "id",
  "id",
  "created_by_user_id",
  'CREATED'::"TaskEventType",
  "created_at"
FROM "tasks";
