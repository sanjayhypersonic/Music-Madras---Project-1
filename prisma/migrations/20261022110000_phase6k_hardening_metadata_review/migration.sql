-- Phase 6K lifecycle hardening, migration 2 of 4: metadata re-review for approved pages.
--
-- An approved page stays public while its YouTube-side metadata changes; a material change is RECORDED as a pending review (never silently treated
-- as reviewed, never revoking the approval by itself). `metadataReviewedSnapshot` is what an editor last reviewed; `video_metadata_changes` is the
-- history of detected changes, one row from first detection to resolution.
--
-- Additive: two nullable columns, one enum, one new table. No existing row is rewritten, so every already-approved page has no baseline yet; the
-- first observation records one (see modules/db/repositories/videoMetadataReviewRepository.ts) rather than inventing a "change".
--
-- RAW SQL, outside the Prisma schema: the partial unique index `video_metadata_changes_one_pending_key` (at most one PENDING change per page).
-- Prisma cannot express a partial index, so it is not declared in schema.prisma. Lifecycle: it is created here, is enforced by PostgreSQL, and is
-- re-created by a fresh `prisma migrate deploy` from zero; `prisma migrate diff` does not report it because Prisma ignores indexes it cannot model.

-- CreateEnum
CREATE TYPE "VideoMetadataChangeStatus" AS ENUM ('PENDING', 'ACKNOWLEDGED', 'REVERTED', 'VOIDED');

-- AlterTable
ALTER TABLE "youtube_video_pages" ADD COLUMN     "metadataReviewedAt" TIMESTAMP(3),
ADD COLUMN     "metadataReviewedSnapshot" JSONB;

-- CreateTable
CREATE TABLE "video_metadata_changes" (
    "id" TEXT NOT NULL,
    "videoPageId" TEXT NOT NULL,
    "status" "VideoMetadataChangeStatus" NOT NULL DEFAULT 'PENDING',
    "baselineFingerprint" TEXT NOT NULL,
    "observedFingerprint" TEXT NOT NULL,
    "changedFields" TEXT[],
    "changeSummary" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastObservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "video_metadata_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_metadata_changes_videoPageId_status_idx" ON "video_metadata_changes"("videoPageId", "status");

-- CreateIndex
CREATE INDEX "video_metadata_changes_status_detectedAt_idx" ON "video_metadata_changes"("status", "detectedAt");

-- AddForeignKey
ALTER TABLE "video_metadata_changes" ADD CONSTRAINT "video_metadata_changes_videoPageId_fkey" FOREIGN KEY ("videoPageId") REFERENCES "youtube_video_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_metadata_changes" ADD CONSTRAINT "video_metadata_changes_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Raw SQL: at most one PENDING change per page.
CREATE UNIQUE INDEX "video_metadata_changes_one_pending_key" ON "video_metadata_changes"("videoPageId") WHERE "status" = 'PENDING';
