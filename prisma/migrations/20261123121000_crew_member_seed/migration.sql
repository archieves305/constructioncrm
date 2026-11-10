-- Seed the CREW_MEMBER role row (roles.name is unique). Its own migration:
-- a new enum value cannot be used in the transaction that added it.
INSERT INTO "roles" ("id", "name", "description", "created_at", "updated_at")
VALUES (
  'role_crew_member_000000000',
  'CREW_MEMBER',
  'A crew worker: their jobs, their tasks, photos, problems and materials. No logs, crew hours or financials.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
