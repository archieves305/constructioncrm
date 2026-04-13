-- CreateEnum
CREATE TYPE "EmailProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PARSED', 'LEAD_CREATED', 'DUPLICATE', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CLICKED');

-- CreateEnum
CREATE TYPE "TrackedActionType" AS ENUM ('OPEN_LEAD', 'ACKNOWLEDGE', 'START_CALL', 'MARK_ATTEMPTED', 'MARK_CONTACTED');

-- CreateTable
CREATE TABLE "inbound_email_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'outlook_graph',
    "external_message_id" TEXT NOT NULL,
    "sender_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "raw_body_text" TEXT,
    "raw_body_html" TEXT,
    "processing_status" "EmailProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "parsed_payload_json" JSONB,
    "parsing_error" TEXT,
    "lead_id" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_email_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_events" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "recipient_address" TEXT NOT NULL,
    "message_body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_action_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action_type" "TrackedActionType" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "clicked_at" TIMESTAMP(3),
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracked_action_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_response_metrics" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "email_received_at" TIMESTAMP(3),
    "lead_created_at" TIMESTAMP(3),
    "sms_sent_at" TIMESTAMP(3),
    "first_open_at" TIMESTAMP(3),
    "acknowledged_at" TIMESTAMP(3),
    "start_call_at" TIMESTAMP(3),
    "first_attempt_at" TIMESTAMP(3),
    "first_contacted_at" TIMESTAMP(3),
    "response_time_seconds" INTEGER,
    "assigned_user_id" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_response_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manager_alert_settings" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
    "sms_phone_number" TEXT,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "alert_email" TEXT,
    "sla_threshold_minutes" INTEGER NOT NULL DEFAULT 5,
    "escalation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "escalation_after_minutes" INTEGER NOT NULL DEFAULT 15,
    "escalation_contact_id" TEXT,

    CONSTRAINT "manager_alert_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_settings" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'outlook_graph',
    "mailbox_address" TEXT,
    "allowed_senders" JSONB,
    "allowed_subjects" JSONB,
    "processed_folder_name" TEXT,
    "polling_interval_sec" INTEGER NOT NULL DEFAULT 60,
    "source_mapping" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "twilio_from_number" TEXT,
    "twilio_enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_assign_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inbound_email_events_external_message_id_key" ON "inbound_email_events"("external_message_id");

-- CreateIndex
CREATE INDEX "inbound_email_events_processing_status_idx" ON "inbound_email_events"("processing_status");

-- CreateIndex
CREATE INDEX "inbound_email_events_sender_email_idx" ON "inbound_email_events"("sender_email");

-- CreateIndex
CREATE INDEX "inbound_email_events_received_at_idx" ON "inbound_email_events"("received_at");

-- CreateIndex
CREATE INDEX "notification_events_lead_id_idx" ON "notification_events"("lead_id");

-- CreateIndex
CREATE INDEX "notification_events_recipient_user_id_idx" ON "notification_events"("recipient_user_id");

-- CreateIndex
CREATE INDEX "notification_events_status_idx" ON "notification_events"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_action_links_token_key" ON "tracked_action_links"("token");

-- CreateIndex
CREATE INDEX "tracked_action_links_token_idx" ON "tracked_action_links"("token");

-- CreateIndex
CREATE INDEX "tracked_action_links_lead_id_idx" ON "tracked_action_links"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_response_metrics_lead_id_key" ON "lead_response_metrics"("lead_id");

-- CreateIndex
CREATE INDEX "lead_response_metrics_assigned_user_id_idx" ON "lead_response_metrics"("assigned_user_id");

-- CreateIndex
CREATE INDEX "lead_response_metrics_source_idx" ON "lead_response_metrics"("source");

-- CreateIndex
CREATE UNIQUE INDEX "manager_alert_settings_user_id_key" ON "manager_alert_settings"("user_id");
