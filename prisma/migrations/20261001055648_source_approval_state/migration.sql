-- CreateEnum
CREATE TYPE "SourceApprovalState" AS ENUM ('UNREVIEWED', 'APPROVED', 'REJECTED', 'DISABLED');

-- AlterTable
ALTER TABLE "sources" ADD COLUMN     "approvalState" "SourceApprovalState" NOT NULL DEFAULT 'UNREVIEWED',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "contentFingerprint" TEXT,
ADD COLUMN     "lastRetrievedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "sources" ADD CONSTRAINT "sources_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
