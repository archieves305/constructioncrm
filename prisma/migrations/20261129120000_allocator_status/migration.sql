-- CC Allocator → CRM Phase 1, step 3: why the intake held a posting.
-- Additive: a nullable column on job_expenses and its enum.
CREATE TYPE "ExpenseHoldReason" AS ENUM ('TWIN', 'LABOR');

ALTER TABLE "job_expenses" ADD COLUMN "hold_reason" "ExpenseHoldReason";
