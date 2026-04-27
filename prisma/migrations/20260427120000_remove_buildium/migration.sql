-- Remove Buildium integration. Rental-turnover columns on jobs are kept.
-- Uses IF EXISTS so this works whether the original buildium_integration
-- migration was already applied to a given environment or not.

DROP INDEX IF EXISTS "jobs_buildium_property_id_idx";
DROP INDEX IF EXISTS "job_expenses_buildium_sync_status_idx";

ALTER TABLE "jobs" DROP COLUMN IF EXISTS "buildium_property_id";
ALTER TABLE "jobs" DROP COLUMN IF EXISTS "buildium_unit_id";

ALTER TABLE "job_expenses" DROP COLUMN IF EXISTS "buildium_bill_id";
ALTER TABLE "job_expenses" DROP COLUMN IF EXISTS "buildium_sync_status";
ALTER TABLE "job_expenses" DROP COLUMN IF EXISTS "buildium_sync_error";
ALTER TABLE "job_expenses" DROP COLUMN IF EXISTS "buildium_synced_at";

DROP TABLE IF EXISTS "buildium_settings";

DROP TYPE IF EXISTS "BuildiumSyncStatus";
