-- AlterTable
ALTER TABLE "daily_labor_entries" ADD COLUMN     "check_in_at" TIMESTAMP(3),
ADD COLUMN     "check_in_lat" DECIMAL(10,7),
ADD COLUMN     "check_in_lng" DECIMAL(10,7),
ADD COLUMN     "check_out_at" TIMESTAMP(3),
ADD COLUMN     "check_out_lat" DECIMAL(10,7),
ADD COLUMN     "check_out_lng" DECIMAL(10,7);

-- AlterTable
ALTER TABLE "daily_logs" ADD COLUMN     "safety_housekeeping" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "safety_ppe_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "safety_toolbox_talk" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "signature_storage_key" TEXT,
ADD COLUMN     "signed_at" TIMESTAMP(3),
ADD COLUMN     "signed_by_name" TEXT;

