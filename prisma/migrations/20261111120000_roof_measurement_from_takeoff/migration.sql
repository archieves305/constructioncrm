-- AlterEnum
ALTER TYPE "RoofMeasurementSource" ADD VALUE 'PLAN_TAKEOFF';

-- AlterTable
ALTER TABLE "roof_measurements" ADD COLUMN     "takeoff_id" TEXT;

-- CreateIndex
CREATE INDEX "roof_measurements_takeoff_id_idx" ON "roof_measurements"("takeoff_id");

-- AddForeignKey
ALTER TABLE "roof_measurements" ADD CONSTRAINT "roof_measurements_takeoff_id_fkey" FOREIGN KEY ("takeoff_id") REFERENCES "takeoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

