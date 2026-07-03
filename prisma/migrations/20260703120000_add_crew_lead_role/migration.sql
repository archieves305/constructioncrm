-- AlterEnum
-- Isolated: Postgres forbids using a new enum value in the same transaction
-- that added it, so this ALTER TYPE ships alone.
ALTER TYPE "RoleName" ADD VALUE 'CREW_LEAD';
