-- Phase 6K-2: scoped, recorded exposure approvals for UNLISTED YouTube videos, and the unlisted-video review queue.
--
-- Additive only: four enums and three new tables (approvals, reviews, review decisions). No existing column or row is altered.
--
-- One data step: a page that already carries the legacy single approval flag (youtube_video_pages."unlistedPublicationApprovedAt")
-- gets a matching PAGE-scope approval row, so the flag and the approval history cannot disagree. The approver recorded is the
-- page's last editor (the legacy flag stored no approver; the audit trail has the original actor). Only the PAGE scope is
-- migrated: no DISCOVERY or PLAYLIST approval is ever created automatically, so nothing newly appears on a discovery surface.
-- (Production holds no video pages when this is written; the statement is a no-op there.)
--
-- Rollout: apply BEFORE deploying the code that reads these tables. Rolling the code back leaves the tables harmless.
-- CreateEnum
CREATE TYPE "VideoExposureScope" AS ENUM ('PAGE', 'DISCOVERY', 'PLAYLIST');

-- CreateEnum
CREATE TYPE "VideoReviewState" AS ENUM ('PENDING', 'INFO_REQUESTED', 'DEFERRED', 'DECLINED', 'APPROVED');

-- CreateEnum
CREATE TYPE "VideoExposureHold" AS ENUM ('RIGHTS', 'COPYRIGHT', 'PRIVACY', 'OTHER');

-- CreateEnum
CREATE TYPE "VideoReviewDecisionKind" AS ENUM ('APPROVE', 'REQUEST_INFO', 'DEFER', 'DECLINE', 'REVOKE');

-- CreateTable
CREATE TABLE "video_exposure_approvals" (
    "id" TEXT NOT NULL,
    "videoPageId" TEXT NOT NULL,
    "scope" "VideoExposureScope" NOT NULL,
    "playlistPageId" TEXT,
    "approvedById" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "revokedById" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokeNote" TEXT,

    CONSTRAINT "video_exposure_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_exposure_reviews" (
    "id" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "state" "VideoReviewState" NOT NULL DEFAULT 'PENDING',
    "proposalFingerprint" TEXT NOT NULL,
    "deferUntil" TIMESTAMP(3),
    "infoRequest" TEXT,
    "holdReason" "VideoExposureHold",
    "holdNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "firstSurfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSurfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_exposure_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_exposure_review_decisions" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "kind" "VideoReviewDecisionKind" NOT NULL,
    "note" TEXT,
    "scopes" JSONB,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "video_exposure_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "video_exposure_approvals_videoPageId_scope_idx" ON "video_exposure_approvals"("videoPageId", "scope");

-- CreateIndex
CREATE INDEX "video_exposure_approvals_scope_revokedAt_idx" ON "video_exposure_approvals"("scope", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "video_exposure_reviews_youtubeVideoId_key" ON "video_exposure_reviews"("youtubeVideoId");

-- CreateIndex
CREATE INDEX "video_exposure_reviews_state_deferUntil_idx" ON "video_exposure_reviews"("state", "deferUntil");

-- CreateIndex
CREATE INDEX "video_exposure_review_decisions_reviewId_createdAt_idx" ON "video_exposure_review_decisions"("reviewId", "createdAt");

-- AddForeignKey
ALTER TABLE "video_exposure_approvals" ADD CONSTRAINT "video_exposure_approvals_videoPageId_fkey" FOREIGN KEY ("videoPageId") REFERENCES "youtube_video_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_exposure_approvals" ADD CONSTRAINT "video_exposure_approvals_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_exposure_approvals" ADD CONSTRAINT "video_exposure_approvals_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_exposure_reviews" ADD CONSTRAINT "video_exposure_reviews_youtubeVideoId_fkey" FOREIGN KEY ("youtubeVideoId") REFERENCES "youtube_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_exposure_reviews" ADD CONSTRAINT "video_exposure_reviews_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_exposure_review_decisions" ADD CONSTRAINT "video_exposure_review_decisions_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "video_exposure_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_exposure_review_decisions" ADD CONSTRAINT "video_exposure_review_decisions_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data step (see header): mirror the legacy PAGE approval flag into the approval history.
INSERT INTO "video_exposure_approvals" ("id", "videoPageId", "scope", "approvedById", "approvedAt", "note")
SELECT gen_random_uuid()::text, p."id", 'PAGE', p."updatedById", p."unlistedPublicationApprovedAt",
       'Migrated from the legacy single approval flag (approver recorded as the page''s last editor).'
FROM "youtube_video_pages" p
WHERE p."unlistedPublicationApprovedAt" IS NOT NULL;