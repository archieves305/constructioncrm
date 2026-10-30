-- CareyOS Work integration: a task sent from a Work board item carries
-- source_key = 'work:<Work idempotency key>'. Unique for those rows only, so a
-- retried or double-clicked send can never create a second task (other
-- automation keys stay deliberately non-unique — see Task.sourceKey).
CREATE UNIQUE INDEX "tasks_source_key_work_key" ON "tasks" ("source_key") WHERE "source_key" LIKE 'work:%';
