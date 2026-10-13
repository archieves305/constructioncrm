-- AlterTable
ALTER TABLE "partner_settings" ADD COLUMN     "health_weights" JSONB,
ADD COLUMN     "health_weights_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "preferred_min_awards" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "preferred_min_margin" DECIMAL(5,4) NOT NULL DEFAULT 0.20;


-- Hand-written: sane bounds on the Preferred thresholds.
ALTER TABLE "partner_settings" ADD CONSTRAINT "partner_settings_preferred_chk" CHECK ("preferred_min_awards" >= 1 AND "preferred_min_margin" >= 0 AND "preferred_min_margin" <= 1);
