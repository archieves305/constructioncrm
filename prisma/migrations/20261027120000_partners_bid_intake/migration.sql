-- CreateEnum
CREATE TYPE "BidIntakeStatus" AS ENUM ('NEW', 'CREATED', 'ATTACHED', 'DISMISSED');

-- CreateTable
CREATE TABLE "bid_intakes" (
    "id" TEXT NOT NULL,
    "inbound_email_event_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "forwarded_by" TEXT,
    "subject" TEXT NOT NULL,
    "platform" "BidPlatform" NOT NULL DEFAULT 'EMAIL',
    "parsed" JSONB NOT NULL,
    "organization_id" TEXT,
    "contact_id" TEXT,
    "matched_by" TEXT,
    "existing_bid_id" TEXT,
    "status" "BidIntakeStatus" NOT NULL DEFAULT 'NEW',
    "bid_invitation_id" TEXT,
    "dismiss_reason" TEXT,
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_intakes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bid_intakes_inbound_email_event_id_key" ON "bid_intakes"("inbound_email_event_id");

-- CreateIndex
CREATE INDEX "bid_intakes_status_received_at_idx" ON "bid_intakes"("status", "received_at");

-- CreateIndex
CREATE INDEX "bid_intakes_organization_id_idx" ON "bid_intakes"("organization_id");

-- AddForeignKey
ALTER TABLE "bid_intakes" ADD CONSTRAINT "bid_intakes_inbound_email_event_id_fkey" FOREIGN KEY ("inbound_email_event_id") REFERENCES "inbound_email_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_intakes" ADD CONSTRAINT "bid_intakes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_intakes" ADD CONSTRAINT "bid_intakes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_intakes" ADD CONSTRAINT "bid_intakes_bid_invitation_id_fkey" FOREIGN KEY ("bid_invitation_id") REFERENCES "bid_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_intakes" ADD CONSTRAINT "bid_intakes_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
