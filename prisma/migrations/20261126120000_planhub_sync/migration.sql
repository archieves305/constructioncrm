-- CreateEnum
CREATE TYPE "PlanhubStage" AS ENUM ('SAVED', 'ESTIMATING', 'BIDDING', 'SUBMITTED', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "PlanhubPageKind" AS ENUM ('BOARD', 'PROJECT');

-- AlterTable
ALTER TABLE "bid_projects" ADD COLUMN     "planhub_due_at" TIMESTAMP(3),
ADD COLUMN     "planhub_name" TEXT,
ADD COLUMN     "planhub_seen_at" TIMESTAMP(3),
ADD COLUMN     "planhub_stage" "PlanhubStage",
ADD COLUMN     "planhub_stage_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "planhub_snapshots" (
    "id" TEXT NOT NULL,
    "kind" "PlanhubPageKind" NOT NULL,
    "url" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "parsed" JSONB NOT NULL,
    "applied" JSONB,
    "applied_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "planhub_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "planhub_snapshots_created_at_idx" ON "planhub_snapshots"("created_at");

-- AddForeignKey
ALTER TABLE "planhub_snapshots" ADD CONSTRAINT "planhub_snapshots_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

