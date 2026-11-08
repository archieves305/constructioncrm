-- Feature-usage log (additive): person, event, kind of record, phone or web, time. No content.
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "subject_type" TEXT,
    "source" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "usage_events_at_idx" ON "usage_events"("at");
CREATE INDEX "usage_events_event_at_idx" ON "usage_events"("event", "at");
CREATE INDEX "usage_events_user_id_at_idx" ON "usage_events"("user_id", "at");
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
