-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('CONTRACT', 'HOURLY', 'PIECEWORK');

-- AlterTable
ALTER TABLE "personnel" ADD COLUMN     "pay_type" "PayType" NOT NULL DEFAULT 'HOURLY',
ADD COLUMN     "work_description" TEXT;

-- CreateTable
CREATE TABLE "job_personnel_scopes" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "personnel_id" TEXT NOT NULL,
    "pay_type" "PayType",
    "work_description" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_personnel_scopes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "job_personnel_scopes_personnel_id_idx" ON "job_personnel_scopes"("personnel_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_personnel_scopes_job_id_personnel_id_key" ON "job_personnel_scopes"("job_id", "personnel_id");

-- AddForeignKey
ALTER TABLE "job_personnel_scopes" ADD CONSTRAINT "job_personnel_scopes_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_personnel_scopes" ADD CONSTRAINT "job_personnel_scopes_personnel_id_fkey" FOREIGN KEY ("personnel_id") REFERENCES "personnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_personnel_scopes" ADD CONSTRAINT "job_personnel_scopes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

