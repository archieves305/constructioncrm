-- Canvassing prospects: prospects become the unit of door-to-door canvassing.
-- Door-knock stops and knocks are repointed from leads to prospects. Existing
-- stop/knock rows reference leads and cannot be mapped to prospects, so they are
-- cleared (canvassing launched the same day; this is test data only).

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED', 'PROMOTED', 'DEAD');

-- Clear lead-based canvassing rows before repointing to prospects.
DELETE FROM "door_knock_route_stops";
DELETE FROM "property_door_knocks";

-- DropForeignKey
ALTER TABLE "door_knock_route_stops" DROP CONSTRAINT "door_knock_route_stops_lead_id_fkey";
ALTER TABLE "property_door_knocks" DROP CONSTRAINT "property_door_knocks_lead_id_fkey";

-- DropIndex
DROP INDEX "door_knock_route_stops_route_id_lead_id_key";
DROP INDEX "property_door_knocks_lead_id_knocked_at_idx";

-- AlterTable
ALTER TABLE "door_knock_route_stops" DROP COLUMN "lead_id",
ADD COLUMN     "prospect_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "property_door_knocks" DROP COLUMN "lead_id",
ADD COLUMN     "prospect_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "prospects" (
    "id" TEXT NOT NULL,
    "reapi_id" TEXT,
    "owner_name" TEXT,
    "property_address_1" TEXT NOT NULL,
    "property_address_2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'FL',
    "zip_code" TEXT,
    "county" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "status" "ProspectStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "assigned_to_user_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "promoted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prospects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospects_lead_id_key" ON "prospects"("lead_id");
CREATE INDEX "prospects_status_idx" ON "prospects"("status");
CREATE INDEX "prospects_assigned_to_user_id_idx" ON "prospects"("assigned_to_user_id");
CREATE INDEX "prospects_latitude_longitude_idx" ON "prospects"("latitude", "longitude");
CREATE INDEX "prospects_reapi_id_idx" ON "prospects"("reapi_id");

-- CreateIndex
CREATE UNIQUE INDEX "door_knock_route_stops_route_id_prospect_id_key" ON "door_knock_route_stops"("route_id", "prospect_id");
CREATE INDEX "property_door_knocks_prospect_id_knocked_at_idx" ON "property_door_knocks"("prospect_id", "knocked_at" DESC);

-- AddForeignKey
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prospects" ADD CONSTRAINT "prospects_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_door_knocks" ADD CONSTRAINT "property_door_knocks_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "door_knock_route_stops" ADD CONSTRAINT "door_knock_route_stops_prospect_id_fkey" FOREIGN KEY ("prospect_id") REFERENCES "prospects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
