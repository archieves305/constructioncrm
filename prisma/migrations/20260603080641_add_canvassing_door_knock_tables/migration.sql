-- CreateEnum
CREATE TYPE "DoorKnockOutcome" AS ENUM ('NO_ANSWER', 'SPOKE_WITH_OWNER', 'SPOKE_WITH_OCCUPANT', 'LEFT_DOOR_HANGER', 'VACANT', 'HOSTILE', 'GATE_BLOCKED', 'OTHER');

-- CreateEnum
CREATE TYPE "DoorKnockRouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DoorKnockStopStatus" AS ENUM ('PENDING', 'VISITED', 'SKIPPED');

-- CreateTable
CREATE TABLE "property_door_knocks" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "outcome" "DoorKnockOutcome" NOT NULL,
    "notes" TEXT,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "accuracy_meters" DECIMAL(7,2),
    "knocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "knocked_by_user_id" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_door_knocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "door_knock_routes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "DoorKnockRouteStatus" NOT NULL DEFAULT 'PLANNED',
    "scheduled_for" DATE,
    "total_distance_miles" DECIMAL(8,2),
    "start_latitude" DECIMAL(10,7),
    "start_longitude" DECIMAL(10,7),
    "start_label" TEXT,
    "is_round_trip" BOOLEAN NOT NULL DEFAULT true,
    "created_by_user_id" TEXT NOT NULL,
    "assigned_to_user_id" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "door_knock_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "door_knock_route_stops" (
    "id" TEXT NOT NULL,
    "route_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "status" "DoorKnockStopStatus" NOT NULL DEFAULT 'PENDING',
    "knock_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "door_knock_route_stops_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "files" ADD COLUMN "door_knock_id" TEXT;

-- CreateIndex
CREATE INDEX "property_door_knocks_lead_id_knocked_at_idx" ON "property_door_knocks"("lead_id", "knocked_at" DESC);

-- CreateIndex
CREATE INDEX "property_door_knocks_knocked_by_user_id_knocked_at_idx" ON "property_door_knocks"("knocked_by_user_id", "knocked_at" DESC);

-- CreateIndex
CREATE INDEX "property_door_knocks_is_deleted_idx" ON "property_door_knocks"("is_deleted");

-- CreateIndex
CREATE INDEX "door_knock_routes_status_is_deleted_idx" ON "door_knock_routes"("status", "is_deleted");

-- CreateIndex
CREATE INDEX "door_knock_routes_assigned_to_user_id_idx" ON "door_knock_routes"("assigned_to_user_id");

-- CreateIndex
CREATE INDEX "door_knock_routes_created_by_user_id_idx" ON "door_knock_routes"("created_by_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "door_knock_route_stops_route_id_lead_id_key" ON "door_knock_route_stops"("route_id", "lead_id");

-- CreateIndex
CREATE INDEX "door_knock_route_stops_route_id_sort_order_idx" ON "door_knock_route_stops"("route_id", "sort_order");

-- CreateIndex
CREATE INDEX "files_door_knock_id_idx" ON "files"("door_knock_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_door_knock_id_fkey" FOREIGN KEY ("door_knock_id") REFERENCES "property_door_knocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_door_knocks" ADD CONSTRAINT "property_door_knocks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_door_knocks" ADD CONSTRAINT "property_door_knocks_knocked_by_user_id_fkey" FOREIGN KEY ("knocked_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_door_knocks" ADD CONSTRAINT "property_door_knocks_deleted_by_user_id_fkey" FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knock_routes" ADD CONSTRAINT "door_knock_routes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knock_routes" ADD CONSTRAINT "door_knock_routes_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knock_route_stops" ADD CONSTRAINT "door_knock_route_stops_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "door_knock_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knock_route_stops" ADD CONSTRAINT "door_knock_route_stops_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "door_knock_route_stops" ADD CONSTRAINT "door_knock_route_stops_knock_id_fkey" FOREIGN KEY ("knock_id") REFERENCES "property_door_knocks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
