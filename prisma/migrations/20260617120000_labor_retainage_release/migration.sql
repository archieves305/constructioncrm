-- AlterTable
ALTER TABLE "labor_contracts" ADD COLUMN     "retainage_released" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retainage_released_date" TIMESTAMP(3);

