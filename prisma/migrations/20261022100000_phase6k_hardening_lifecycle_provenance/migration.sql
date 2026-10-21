-- Phase 6K lifecycle hardening, migration 1 of 4: approval provenance and lifecycle invalidation.
--
-- What this does:
--   1. Adds `revokedReason` (why an approval ended: an editor's decision, or a lifecycle invalidation such as the video going private or the page
--      being archived) so Studio can tell them apart and ask for a FRESH approval when one is needed.
--   2. Makes `approvedById` nullable. The legacy single flag recorded NO approver; migration 20261021110000 stored the page's last editor in its
--      place, which falsely attributes an approval to someone who merely edited the page. Carried-over approvals now record no approver.
--   3. Adds HOLD_SET and HOLD_CLEARED to the review decision kinds (holds used to be recorded as DECLINE and REQUEST_INFO).
--   4. Corrects data written by the earlier carry-over migrations (legacy-origin rows only; editor-made approvals keep their approver):
--        a. clears the inferred approver on every carried-over approval and replaces the note that claimed one;
--        b. revokes every active approval of a page that is ARCHIVED or whose video is PRIVATE (the lifecycle rules: such an approval must not
--           survive, and coming back requires a fresh approval), clearing the legacy flag with it;
--        c. revokes carried-over LISTING (DISCOVERY) approvals on pages that are still drafts: a legacy flag on a page that was never published did
--           not list anything, so it must not grant listing now.
--      Each revocation writes an audit entry with no human actor (the platform did it, and which migration).
--
-- Additive and idempotent: one enum, one nullable column, a constraint relaxed (NOT NULL dropped), two enum values, and UPDATE/INSERT steps that
-- only match rows still in the state they correct, so running the data steps again changes nothing. There is no down-migration: revoked approvals
-- are never deleted, and a revoked approval can be re-approved explicitly in Studio. Lock behaviour: brief locks on a small table.
--
-- The new enum values are not used in this migration (PostgreSQL does not allow using a value in the transaction that adds it).

-- CreateEnum
CREATE TYPE "VideoExposureRevokeReason" AS ENUM ('EDITOR', 'REVIEW_DECISION', 'HOLD', 'VIDEO_PRIVATE', 'VIDEO_UNAVAILABLE', 'PAGE_ARCHIVED', 'RECONCILED', 'MIGRATION');

-- AlterEnum
ALTER TYPE "VideoReviewDecisionKind" ADD VALUE IF NOT EXISTS 'HOLD_SET';
ALTER TYPE "VideoReviewDecisionKind" ADD VALUE IF NOT EXISTS 'HOLD_CLEARED';

-- AlterTable
ALTER TABLE "video_exposure_approvals" ADD COLUMN     "revokedReason" "VideoExposureRevokeReason",
ALTER COLUMN "approvedById" DROP NOT NULL;

-- Data step a: no invented approver on a carried-over approval.
UPDATE "video_exposure_approvals"
SET "approvedById" = NULL,
    "note" = 'Carried over from the legacy single approval flag. That flag recorded no approver and no reviewer, so none is recorded here; the audit trail may hold the original actor. Reconsider it in Studio (Unlisted videos > Carried-over approvals).'
WHERE "origin" IN ('MIGRATED_LEGACY', 'RECONCILED_LEGACY')
  AND "approvedById" IS NOT NULL;

-- Data step b: an approval cannot survive on an archived page or on a private video.
WITH affected AS (
  SELECT p."id" AS "pageId",
         CASE WHEN p."archivedAt" IS NOT NULL THEN 'PAGE_ARCHIVED'::"VideoExposureRevokeReason" ELSE 'VIDEO_PRIVATE'::"VideoExposureRevokeReason" END AS "reason"
  FROM "youtube_video_pages" p
  JOIN "youtube_videos" v ON v."id" = p."youtubeVideoId"
  WHERE p."archivedAt" IS NOT NULL OR v."privacyStatus" = 'private'
),
revoked AS (
  UPDATE "video_exposure_approvals" a
  SET "revokedAt" = CURRENT_TIMESTAMP,
      "revokedReason" = af."reason",
      "revokeNote" = 'Revoked by the lifecycle rules (migration): an approval does not survive the page being archived or the video becoming private. Approve again explicitly if it should be public.'
  FROM affected af
  WHERE a."videoPageId" = af."pageId" AND a."revokedAt" IS NULL
  RETURNING a."id", a."videoPageId", a."scope", a."revokedReason"
)
INSERT INTO "audit_log_entries" ("id", "actorId", "action", "entityType", "entityId", "afterSnapshot")
SELECT gen_random_uuid()::text, NULL, 'VIDEO_EXPOSURE_REVOKED', 'YouTubeVideoPage', r."videoPageId",
       jsonb_build_object('scope', r."scope"::text, 'approvalId', r."id", 'reason', r."revokedReason"::text, 'migration', '20261022100000_phase6k_hardening_lifecycle_provenance')
FROM revoked r;

-- The legacy flag is the cache of "an active PAGE approval exists": keep it in step for the pages just handled.
UPDATE "youtube_video_pages" p
SET "unlistedPublicationApprovedAt" = NULL
WHERE p."unlistedPublicationApprovedAt" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "video_exposure_approvals" a WHERE a."videoPageId" = p."id" AND a."scope" = 'PAGE' AND a."revokedAt" IS NULL)
  AND (p."archivedAt" IS NOT NULL OR EXISTS (SELECT 1 FROM "youtube_videos" v WHERE v."id" = p."youtubeVideoId" AND v."privacyStatus" = 'private'));

-- Data step c: a carried-over LISTING approval on a page that is still a draft is not carried over.
WITH revoked AS (
  UPDATE "video_exposure_approvals" a
  SET "revokedAt" = CURRENT_TIMESTAMP,
      "revokedReason" = 'MIGRATION',
      "revokeNote" = 'Not carried over: the page was a draft when the legacy approval was migrated, so it was never publicly listed. Approve listing explicitly if it should be listed.'
  FROM "youtube_video_pages" p
  WHERE a."videoPageId" = p."id"
    AND a."origin" IN ('MIGRATED_LEGACY', 'RECONCILED_LEGACY')
    AND a."scope" = 'DISCOVERY'
    AND a."revokedAt" IS NULL
    AND p."status" <> 'PUBLISHED'
  RETURNING a."id", a."videoPageId", a."scope"
)
INSERT INTO "audit_log_entries" ("id", "actorId", "action", "entityType", "entityId", "afterSnapshot")
SELECT gen_random_uuid()::text, NULL, 'VIDEO_EXPOSURE_REVOKED', 'YouTubeVideoPage', r."videoPageId",
       jsonb_build_object('scope', r."scope"::text, 'approvalId', r."id", 'reason', 'MIGRATION', 'migration', '20261022100000_phase6k_hardening_lifecycle_provenance')
FROM revoked r;
