-- CreateEnum
CREATE TYPE "LearningGuideStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "learning_guides" ADD COLUMN     "status" "LearningGuideStatus" NOT NULL DEFAULT 'DRAFT';
