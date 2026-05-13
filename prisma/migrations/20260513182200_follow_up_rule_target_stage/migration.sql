-- AlterTable
ALTER TABLE "follow_up_rules" ADD COLUMN     "target_stage_id" TEXT;

-- CreateIndex
CREATE INDEX "follow_up_rules_target_stage_id_idx" ON "follow_up_rules"("target_stage_id");

-- AddForeignKey
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_target_stage_id_fkey" FOREIGN KEY ("target_stage_id") REFERENCES "lead_stages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
