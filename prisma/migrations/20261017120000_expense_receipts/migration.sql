-- AlterEnum
ALTER TYPE "FileCategory" ADD VALUE 'RECEIPT';

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "expense_id" TEXT;

-- CreateIndex
CREATE INDEX "files_expense_id_idx" ON "files"("expense_id");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "job_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

