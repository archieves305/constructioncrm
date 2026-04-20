-- AlterTable
ALTER TABLE "notification_events" ADD COLUMN     "read_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notification_events_recipient_user_id_read_at_idx" ON "notification_events"("recipient_user_id", "read_at");
