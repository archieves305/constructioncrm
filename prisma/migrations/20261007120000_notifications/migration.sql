-- Notifications v2: one Notification row per recipient per event (the bell),
-- a per-person-per-window digest ledger, company delivery settings, and the
-- per-user delivery preferences. See docs/project-memory/features/notifications.md.

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('TASKS', 'MENTIONS', 'REMINDERS', 'ESCALATIONS', 'VIOLATIONS', 'JOB_ACTIVITY');

-- CreateEnum
CREATE TYPE "NotificationEmailMode" AS ENUM ('DIGEST', 'IMMEDIATE', 'IN_APP_ONLY');

-- CreateEnum
CREATE TYPE "DeliveryClass" AS ENUM ('IMMEDIATE', 'DIGEST', 'IN_APP_ONLY', 'NONE');

-- CreateEnum
CREATE TYPE "NotificationState" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'SUPPRESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "DigestStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED_EMPTY', 'SKIPPED_MUTED');

-- AlterEnum (a pure addition; the generated type swap would also strip any
-- value another migration adds to this enum)
ALTER TYPE "TaskEventType" ADD VALUE 'NOTIFIED' BEFORE 'NUDGED';

-- AlterTable
ALTER TABLE "users"
ADD COLUMN     "digest_windows" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "muted_categories" "NotificationCategory"[] DEFAULT ARRAY[]::"NotificationCategory"[],
ADD COLUMN     "notification_email_mode" "NotificationEmailMode" NOT NULL DEFAULT 'DIGEST';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "kind" TEXT NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "recipient_reason" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT,
    "task_id" TEXT,
    "job_id" TEXT,
    "lead_id" TEXT,
    "violation_case_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "action_required" BOOLEAN NOT NULL DEFAULT false,
    "signals" JSONB,
    "batch_key" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "last_occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivery_class" "DeliveryClass" NOT NULL,
    "classify_reason" TEXT NOT NULL,
    "demoted_from" "DeliveryClass",
    "demoted_reason" TEXT,
    "scheduled_window_key" TEXT,
    "state" "NotificationState" NOT NULL DEFAULT 'PENDING',
    "digest_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "emailed_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_digests" (
    "id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "window_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "status" "DigestStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "provider_message_id" TEXT,
    "subject" TEXT,
    "item_count" INTEGER NOT NULL DEFAULT 0,
    "collapsed_count" INTEGER NOT NULL DEFAULT 0,
    "hidden_count" INTEGER NOT NULL DEFAULT 0,
    "suppressed_count" INTEGER NOT NULL DEFAULT 0,
    "section_counts" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_digests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "time_zone" TEXT NOT NULL DEFAULT 'America/New_York',
    "digest_windows" TEXT[] DEFAULT ARRAY['08:00', '12:00', '15:30', '18:00']::TEXT[],
    "weekdays_only" BOOLEAN NOT NULL DEFAULT true,
    "catch_up_grace_minutes" INTEGER NOT NULL DEFAULT 90,
    "immediate_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "digest_only_kinds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "max_immediate_per_user_per_hour" INTEGER NOT NULL DEFAULT 6,
    "batch_collapse_threshold" INTEGER NOT NULL DEFAULT 3,
    "storm_threshold_per_10_min" INTEGER NOT NULL DEFAULT 40,
    "digest_max_per_section" INTEGER NOT NULL DEFAULT 12,
    "digest_max_per_subject" INTEGER NOT NULL DEFAULT 6,
    "retention_days" INTEGER NOT NULL DEFAULT 90,
    "last_morning_produced_on" TEXT,
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_created_at_idx" ON "notifications"("recipient_user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_recipient_user_id_read_at_idx" ON "notifications"("recipient_user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_state_scheduled_window_key_idx" ON "notifications"("state", "scheduled_window_key");

-- CreateIndex
CREATE INDEX "notifications_digest_id_idx" ON "notifications"("digest_id");

-- CreateIndex
CREATE INDEX "notifications_batch_key_idx" ON "notifications"("batch_key");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "notifications_task_id_idx" ON "notifications"("task_id");

-- CreateIndex
CREATE INDEX "notifications_job_id_idx" ON "notifications"("job_id");

-- CreateIndex
CREATE INDEX "notifications_lead_id_idx" ON "notifications"("lead_id");

-- CreateIndex
CREATE INDEX "notifications_violation_case_id_idx" ON "notifications"("violation_case_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_user_id_dedupe_key_key" ON "notifications"("recipient_user_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "notification_digests_status_scheduled_for_idx" ON "notification_digests"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "notification_digests_recipient_user_id_created_at_idx" ON "notification_digests"("recipient_user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_digests_recipient_user_id_window_key_key" ON "notification_digests"("recipient_user_id", "window_key");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_violation_case_id_fkey" FOREIGN KEY ("violation_case_id") REFERENCES "code_violation_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_digest_id_fkey" FOREIGN KEY ("digest_id") REFERENCES "notification_digests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_digests" ADD CONSTRAINT "notification_digests_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: carry the four legacy switches onto the new preference model so
-- nobody who had muted mail starts receiving it again. The legacy columns
-- stay until the legacy send path is deleted (Stage 4).
UPDATE "users" SET "notification_email_mode" = 'IN_APP_ONLY' WHERE "task_emails_enabled" = false;
UPDATE "users" SET "muted_categories" = array_append("muted_categories", 'REMINDERS'::"NotificationCategory") WHERE "reminder_digest_enabled" = false;
UPDATE "users" SET "muted_categories" = array_append("muted_categories", 'ESCALATIONS'::"NotificationCategory") WHERE "escalation_emails_enabled" = false;
UPDATE "users" SET "muted_categories" = array_append("muted_categories", 'MENTIONS'::"NotificationCategory") WHERE "nudge_emails_enabled" = false;

-- The bell now reads "notifications"; the old lead-scoped IN_APP send-log
-- rows would otherwise sit unread forever behind a badge nobody can clear.
UPDATE "notification_events" SET "read_at" = CURRENT_TIMESTAMP WHERE "channel" = 'IN_APP' AND "read_at" IS NULL;
