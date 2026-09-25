-- CreateEnum
CREATE TYPE "NurtureContentKind" AS ENUM ('FOLLOW_UP', 'NURTURE');

-- CreateEnum
CREATE TYPE "LeadNurtureStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED');

-- CreateEnum
CREATE TYPE "LeadNurtureSendStatus" AS ENUM ('SENT', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "nurture_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "follow_up_days" INTEGER[] DEFAULT ARRAY[2, 7, 14, 30]::INTEGER[],
    "follow_up_every_days_after" INTEGER NOT NULL DEFAULT 30,
    "nurture_days" INTEGER[] DEFAULT ARRAY[4, 10, 21]::INTEGER[],
    "nurture_every_days_after" INTEGER NOT NULL DEFAULT 30,
    "nurture_monthly_offset_days" INTEGER NOT NULL DEFAULT 15,
    "min_gap_hours" INTEGER NOT NULL DEFAULT 48,
    "send_window_start_hour" INTEGER NOT NULL DEFAULT 8,
    "send_window_end_hour" INTEGER NOT NULL DEFAULT 11,
    "time_zone" TEXT NOT NULL DEFAULT 'America/New_York',
    "weekdays_only" BOOLEAN NOT NULL DEFAULT true,
    "personal_touch_skip_days" INTEGER NOT NULL DEFAULT 3,
    "rep_prompt_after_days" INTEGER NOT NULL DEFAULT 10,
    "excluded_stage_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_user_id" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nurture_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nurture_content" (
    "id" TEXT NOT NULL,
    "kind" "NurtureContentKind" NOT NULL,
    "step" INTEGER,
    "seed_key" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "edited_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nurture_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_nurture_states" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" "LeadNurtureStatus" NOT NULL DEFAULT 'ACTIVE',
    "stopped_reason" TEXT,
    "paused_reason" TEXT,
    "paused_by_user_id" TEXT,
    "enrolled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anchor_at" TIMESTAMP(3) NOT NULL,
    "anchor_reason" TEXT NOT NULL,
    "follow_up_step" INTEGER NOT NULL DEFAULT 0,
    "nurture_base_at" TIMESTAMP(3) NOT NULL,
    "nurture_slot" INTEGER NOT NULL DEFAULT 0,
    "next_follow_up_at" TIMESTAMP(3),
    "next_nurture_at" TIMESTAMP(3),
    "last_follow_up_at" TIMESTAMP(3),
    "last_nurture_at" TIMESTAMP(3),
    "last_auto_email_at" TIMESTAMP(3),
    "last_personal_touch_at" TIMESTAMP(3),
    "rep_prompted_at" TIMESTAMP(3),
    "steps_exhausted_notified_at" TIMESTAMP(3),
    "nurture_exhausted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_nurture_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_nurture_sends" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "state_id" TEXT NOT NULL,
    "kind" "NurtureContentKind" NOT NULL,
    "content_id" TEXT,
    "step" INTEGER,
    "slot_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" "LeadNurtureSendStatus" NOT NULL,
    "error" TEXT,
    "subject" TEXT NOT NULL,
    "to_email" TEXT NOT NULL,
    "communication_id" TEXT,
    "external_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_nurture_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nurture_content_seed_key_key" ON "nurture_content"("seed_key");

-- CreateIndex
CREATE INDEX "nurture_content_kind_is_active_sort_order_idx" ON "nurture_content"("kind", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "lead_nurture_states_lead_id_key" ON "lead_nurture_states"("lead_id");

-- CreateIndex
CREATE INDEX "lead_nurture_states_status_next_follow_up_at_idx" ON "lead_nurture_states"("status", "next_follow_up_at");

-- CreateIndex
CREATE INDEX "lead_nurture_states_status_next_nurture_at_idx" ON "lead_nurture_states"("status", "next_nurture_at");

-- CreateIndex
CREATE INDEX "lead_nurture_sends_lead_id_kind_content_id_idx" ON "lead_nurture_sends"("lead_id", "kind", "content_id");

-- CreateIndex
CREATE INDEX "lead_nurture_sends_to_email_sent_at_idx" ON "lead_nurture_sends"("to_email", "sent_at");

-- CreateIndex
CREATE INDEX "lead_nurture_sends_created_at_idx" ON "lead_nurture_sends"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_nurture_sends_lead_id_slot_key_key" ON "lead_nurture_sends"("lead_id", "slot_key");

-- AddForeignKey
ALTER TABLE "lead_nurture_states" ADD CONSTRAINT "lead_nurture_states_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_nurture_sends" ADD CONSTRAINT "lead_nurture_sends_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_nurture_sends" ADD CONSTRAINT "lead_nurture_sends_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "lead_nurture_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_nurture_sends" ADD CONSTRAINT "lead_nurture_sends_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "nurture_content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

