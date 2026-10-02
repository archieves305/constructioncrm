-- A file on a task that has no lead (a task raised with no job) has no lead either.
ALTER TABLE "files" ALTER COLUMN "lead_id" DROP NOT NULL;
