-- Permit Intelligence, Stage 6: lessons learned from accepted corrections —
-- their grouping, the comments they came from, and an optional preflight check.

-- AlterTable
ALTER TABLE "permit_knowledge" ADD COLUMN     "ai_call_id" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "check" JSONB,
ADD COLUMN     "group_key" TEXT,
ADD COLUMN     "source_item_ids" TEXT[],
ADD COLUMN     "target" TEXT;

-- CreateIndex
CREATE INDEX "permit_knowledge_group_key_idx" ON "permit_knowledge"("group_key");
