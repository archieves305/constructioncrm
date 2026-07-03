-- Seed the CREW_LEAD role row (roles.name is unique)
INSERT INTO "roles" ("id", "name", "description", "created_at", "updated_at")
VALUES (
  'role_crew_lead_00000000000',
  'CREW_LEAD',
  'Field access to assigned jobs: daily logs, hours, photos, issues. No financials.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;

-- AlterTable: field-module per-user grants
ALTER TABLE "users" ADD COLUMN     "can_edit_pay_rates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_view_payroll_reports" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "can_view_sensitive_personnel" BOOLEAN NOT NULL DEFAULT false;
