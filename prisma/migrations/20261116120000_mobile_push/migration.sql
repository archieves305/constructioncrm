-- AlterTable
ALTER TABLE "users" ADD COLUMN     "push_enabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "mobile_devices" ADD COLUMN     "push_token" TEXT,
ADD COLUMN     "push_token_at" TIMESTAMP(3);

