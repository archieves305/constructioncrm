-- CreateEnum
CREATE TYPE "ListScope" AS ENUM ('MINE', 'ALL');

-- CreateEnum
CREATE TYPE "BoardDensity" AS ENUM ('COMFORTABLE', 'COMPACT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "board_density" "BoardDensity" NOT NULL DEFAULT 'COMFORTABLE',
ADD COLUMN     "default_list_scope" "ListScope" NOT NULL DEFAULT 'MINE';

