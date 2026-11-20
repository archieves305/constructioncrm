-- Owned projects (flips + rentals) as a second kind of job. Additive.
CREATE TYPE "JobKind" AS ENUM ('CLIENT', 'FLIP', 'RENTAL');
CREATE TYPE "OwnedPurpose" AS ENUM ('FLIP', 'RENTAL');
ALTER TYPE "LeadKind" ADD VALUE 'INTERNAL';

ALTER TABLE "job_stages" ADD COLUMN "kinds" "JobKind"[] DEFAULT ARRAY['CLIENT']::"JobKind"[];

ALTER TABLE "jobs" ADD COLUMN "owned_purpose" "OwnedPurpose",
ADD COLUMN "purchase_price" DECIMAL(12,2),
ADD COLUMN "after_repair_value" DECIMAL(12,2),
ADD COLUMN "sale_price" DECIMAL(12,2),
ADD COLUMN "sale_date" TIMESTAMP(3),
ADD COLUMN "monthly_rent" DECIMAL(12,2);

-- The stage lists (mirrors STAGE_SEED in src/lib/jobs/stage-kinds.ts). A
-- stage that already exists keeps its id and closed flag; its order and
-- kinds are set. Stages an admin added stay client-only.
INSERT INTO "job_stages" ("id", "name", "stage_order", "is_closed", "kinds", "created_at", "updated_at") VALUES
  ('jst_' || md5('Won'), 'Won', 1, false, ARRAY['CLIENT']::"JobKind"[], now(), now()),
  ('jst_' || md5('Planning'), 'Planning', 1, false, ARRAY['FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Deposit Needed'), 'Deposit Needed', 2, false, ARRAY['CLIENT']::"JobKind"[], now(), now()),
  ('jst_' || md5('Financing Cleared'), 'Financing Cleared', 3, false, ARRAY['CLIENT']::"JobKind"[], now(), now()),
  ('jst_' || md5('Measure Complete'), 'Measure Complete', 4, false, ARRAY['CLIENT']::"JobKind"[], now(), now()),
  ('jst_' || md5('Scope Finalized'), 'Scope Finalized', 5, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Permit Submitted'), 'Permit Submitted', 6, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Permit Corrections'), 'Permit Corrections', 7, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Permit Approved'), 'Permit Approved', 8, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Materials Ordered'), 'Materials Ordered', 9, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Scheduled'), 'Scheduled', 10, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('In Progress'), 'In Progress', 11, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Punch List'), 'Punch List', 12, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Final Inspection'), 'Final Inspection', 13, false, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Final Payment Due'), 'Final Payment Due', 14, false, ARRAY['CLIENT']::"JobKind"[], now(), now()),
  ('jst_' || md5('Listed'), 'Listed', 14, false, ARRAY['FLIP']::"JobKind"[], now(), now()),
  ('jst_' || md5('Under Contract'), 'Under Contract', 15, false, ARRAY['FLIP']::"JobKind"[], now(), now()),
  ('jst_' || md5('Sold'), 'Sold', 16, true, ARRAY['FLIP']::"JobKind"[], now(), now()),
  ('jst_' || md5('Ready to Rent'), 'Ready to Rent', 14, false, ARRAY['RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Leased'), 'Leased', 15, true, ARRAY['RENTAL']::"JobKind"[], now(), now()),
  ('jst_' || md5('Closed'), 'Closed', 20, true, ARRAY['CLIENT', 'FLIP', 'RENTAL']::"JobKind"[], now(), now())
ON CONFLICT ("name") DO UPDATE SET "stage_order" = EXCLUDED."stage_order", "kinds" = EXCLUDED."kinds", "updated_at" = now();

-- An owned project already on a job keeps the flip list until someone says otherwise.
UPDATE "jobs" SET "owned_purpose" = CASE WHEN "is_rental_turnover" THEN 'RENTAL'::"OwnedPurpose" ELSE 'FLIP'::"OwnedPurpose" END
WHERE "job_type" = 'OWNED_REHAB' AND "owned_purpose" IS NULL;
