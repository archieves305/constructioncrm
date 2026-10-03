-- AlterTable
ALTER TABLE "files" ADD COLUMN     "job_id" TEXT;

-- CreateIndex
CREATE INDEX "files_job_id_idx" ON "files"("job_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill (hand-appended). Each rule only fills rows still without a job.
-- 1. A file on a task takes the task's job.
UPDATE "files" f SET "job_id" = t."job_id"
FROM "tasks" t
WHERE f."task_id" = t."id" AND t."job_id" IS NOT NULL AND f."job_id" IS NULL;

-- 2. A generated document (labor contract, addendum, customer contract,
--    signed PDF) knows its job.
UPDATE "files" f SET "job_id" = g."job_id"
FROM "generated_documents" g
WHERE g."file_id" = f."id" AND f."job_id" IS NULL;

-- 3. Any other file on a lead with exactly one job takes that job. Files on a
--    code-violation case are left alone (a case links to its jobs itself), as
--    are leads with no job or several: those stay lead documents.
UPDATE "files" f SET "job_id" = j."id"
FROM "jobs" j
WHERE j."lead_id" = f."lead_id"
  AND f."job_id" IS NULL
  AND f."violation_case_id" IS NULL
  AND (SELECT count(*) FROM "jobs" j2 WHERE j2."lead_id" = f."lead_id") = 1;
