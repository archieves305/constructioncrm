-- Crew Release 1 (additive only).

-- What crews may open, set by an admin.
ALTER TABLE "labor_settings"
  ADD COLUMN "crew_file_categories" "FileCategory"[] NOT NULL DEFAULT ARRAY['PLAN_SET', 'PHOTOS', 'VIDEO', 'PERMIT', 'INSPECTION']::"FileCategory"[];

-- A field photo's stage, and a per-file crew visibility override.
CREATE TYPE "PhotoPhase" AS ENUM ('BEFORE', 'DURING', 'AFTER');
ALTER TABLE "files"
  ADD COLUMN "crew_visible" BOOLEAN,
  ADD COLUMN "phase" "PhotoPhase";

-- The crew's start time on the install day, and who confirmed in the app.
ALTER TABLE "crew_assignments"
  ADD COLUMN "start_minutes" INTEGER,
  ADD COLUMN "confirmed_by_user_id" TEXT;

-- A staff member's work number, for "Call the PM" on a crew phone.
ALTER TABLE "users" ADD COLUMN "phone" TEXT;
