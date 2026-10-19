-- CreateEnum
CREATE TYPE "EstimateCostType" AS ENUM ('LABOR', 'MATERIAL', 'SUB', 'EQUIPMENT', 'OTHER');

-- AlterEnum
ALTER TYPE "EstimateUnitType" ADD VALUE 'SQUARE';

-- AlterTable
ALTER TABLE "estimate_line_items" ADD COLUMN     "cost_type" "EstimateCostType" NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "estimate_sections" ADD COLUMN     "roof_measurement_id" TEXT;

-- AlterTable
ALTER TABLE "estimates" ADD COLUMN     "overhead_percent" DECIMAL(6,3) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "estimate_sections" ADD CONSTRAINT "estimate_sections_roof_measurement_id_fkey" FOREIGN KEY ("roof_measurement_id") REFERENCES "roof_measurements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

