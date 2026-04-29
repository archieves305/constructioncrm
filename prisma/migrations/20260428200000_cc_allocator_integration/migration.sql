-- cc-allocator integration: add idempotency key to job_expenses + seed a
-- system user that integration writes attribute to.

-- Idempotency key. Nullable so manually-created expenses are unaffected.
-- cc-allocator passes its Transaction.id as externalId; the unique index
-- makes a retried POST a no-op (returns the existing row).
ALTER TABLE "job_expenses" ADD COLUMN "external_id" TEXT;
CREATE UNIQUE INDEX "job_expenses_external_id_key" ON "job_expenses"("external_id");

-- System user that integration POSTs use as created_by_user_id. Login is
-- locked: is_active = false (auth refuses inactive users) and
-- password_hash is a sentinel that's not a valid bcrypt output (bcrypt
-- hashes always start with "$2"). Role = READ_ONLY for principle of least
-- privilege; the user only exists as an FK target.
INSERT INTO "users" (
    "id", "first_name", "last_name", "email", "password_hash",
    "role_id", "is_active", "created_at", "updated_at"
)
SELECT
    'sysuser-cc-allocator',
    'CC Allocator',
    'Integration',
    'cc-allocator@integrations.knuconstruction.local',
    '!locked-no-login!',
    r.id,
    false,
    NOW(),
    NOW()
FROM "roles" r
WHERE r.name = 'READ_ONLY'
ON CONFLICT ("email") DO NOTHING;
