-- Add new columns
ALTER TABLE "crews" ADD COLUMN "phone" TEXT;
ALTER TABLE "crews" ADD COLUMN "email" TEXT;
ALTER TABLE "crews" ADD COLUMN "trades" TEXT[] NOT NULL DEFAULT '{}';

-- Migrate existing trade_type into trades array
UPDATE "crews" SET "trades" = ARRAY["trade_type"] WHERE "trade_type" IS NOT NULL AND "trade_type" <> '';

-- Drop old column
ALTER TABLE "crews" DROP COLUMN "trade_type";
