-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CHECK', 'CARD', 'ACH', 'CASH', 'FINANCING', 'WIRE', 'OTHER');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "method" "PaymentMethod",
ADD COLUMN     "reference" TEXT;
