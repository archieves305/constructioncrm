-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "original_contract_amount" DECIMAL(12,2);

-- Jobs with a signed customer contract whose money was applied: the contract's
-- own amount is the base. Everything else stays null and is derived on read.
UPDATE "jobs" j
SET "original_contract_amount" = c."contract_amount"
FROM "customer_contracts" c
WHERE c."job_id" = j."id"
  AND c."status" = 'SIGNED'
  AND c."money_applied_at" IS NOT NULL
  AND j."job_type" = 'FIXED_PRICE';
