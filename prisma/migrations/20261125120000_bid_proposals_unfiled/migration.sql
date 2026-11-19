-- An uploaded estimate is kept before its project is chosen (Stage 1b): the
-- proposal's project link is filled when a person confirms the review.
-- AlterTable
ALTER TABLE "bid_proposal_versions" ADD COLUMN     "supporting_file_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "supporting_text" TEXT,
ALTER COLUMN "bid_project_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "bid_proposals" ALTER COLUMN "bid_project_id" DROP NOT NULL;
