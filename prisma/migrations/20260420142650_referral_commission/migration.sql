-- AlterTable
ALTER TABLE "referrals" ADD COLUMN     "commission_amount" DECIMAL(12,2),
ADD COLUMN     "commission_paid_at" TIMESTAMP(3);
