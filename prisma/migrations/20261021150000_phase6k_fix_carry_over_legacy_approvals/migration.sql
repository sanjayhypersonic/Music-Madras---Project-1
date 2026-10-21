-- Phase 6K fix (F2): carry the old single approval over WITHOUT silently delisting anything, and mark every carried-over approval so it can be
-- reconsidered in Studio.
--
-- Before the exposure-approval work, an approved unlisted video's page was both reachable AND listed everywhere (homepage, entity pages, sitemap).
-- The earlier migration (20261021110000) carried the flag over as a PAGE approval only, which would have removed those videos from every listing.
-- This migration keeps their existing exposure exactly as it was:
--   1. adds `origin` (who made an approval) and `confirmedAt/confirmedById` (an editor reconsidered a carried-over approval and kept it);
--   2. marks the PAGE approvals created by the earlier migration as MIGRATED_LEGACY;
--   3. gives each of those pages an explicit, clearly marked, active DISCOVERY approval (approver and time copied from the legacy approval),
--      so the page stays listed — ONLY for pages that already carried the legacy approval; no other unlisted video is approved or listed;
--   4. records an audit entry for every carried-over approval (actor NULL: the platform did it, not a person).
-- Nothing is granted to a video that was not approved before. Approvals made by editors in Studio are never touched (origin stays EDITOR).
--
-- Additive: one enum, three nullable/defaulted columns, one foreign key, and inserts. Lock behaviour: a brief ACCESS EXCLUSIVE on
-- video_exposure_approvals (empty or near-empty), metadata-only column additions, no table rewrite.
--
-- Rollout: apply together with the earlier exposure migration and BEFORE deploying the code that reads these tables; see
-- docs/runbooks/exposure-approvals-rollout.md (including the reconciliation step and rollback).

-- CreateEnum
CREATE TYPE "VideoExposureOrigin" AS ENUM ('EDITOR', 'MIGRATED_LEGACY', 'RECONCILED_LEGACY');

-- AlterTable
ALTER TABLE "video_exposure_approvals" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "origin" "VideoExposureOrigin" NOT NULL DEFAULT 'EDITOR';

-- AddForeignKey
ALTER TABLE "video_exposure_approvals" ADD CONSTRAINT "video_exposure_approvals_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data step 1: mark the PAGE approvals the earlier migration created from the legacy flag.
UPDATE "video_exposure_approvals"
SET "origin" = 'MIGRATED_LEGACY'
WHERE "scope" = 'PAGE'
  AND "revokedAt" IS NULL
  AND "note" LIKE 'Migrated from the legacy single approval flag%';

-- Data step 2: preserve public listing for exactly those pages (and only those), as an explicit, marked approval.
INSERT INTO "video_exposure_approvals" ("id", "videoPageId", "scope", "approvedById", "approvedAt", "note", "origin")
SELECT gen_random_uuid()::text, a."videoPageId", 'DISCOVERY', a."approvedById", a."approvedAt",
       'Carried over by the migration: the legacy approval also allowed this video to be listed publicly, so listing is preserved as an explicit approval. Reconsider it in Studio (Unlisted videos > Carried-over approvals).',
       'MIGRATED_LEGACY'
FROM "video_exposure_approvals" a
WHERE a."origin" = 'MIGRATED_LEGACY'
  AND a."scope" = 'PAGE'
  AND a."revokedAt" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "video_exposure_approvals" d WHERE d."videoPageId" = a."videoPageId" AND d."scope" = 'DISCOVERY');

-- Data step 3: one audit entry per carried-over approval (PAGE and DISCOVERY), with no human actor.
INSERT INTO "audit_log_entries" ("id", "actorId", "action", "entityType", "entityId", "afterSnapshot")
SELECT gen_random_uuid()::text, NULL, 'VIDEO_EXPOSURE_CARRIED_OVER', 'YouTubeVideoPage', a."videoPageId",
       jsonb_build_object('scope', a."scope"::text, 'origin', 'MIGRATED_LEGACY', 'approvalId', a."id", 'migration', '20261021150000_phase6k_fix_carry_over_legacy_approvals')
FROM "video_exposure_approvals" a
WHERE a."origin" = 'MIGRATED_LEGACY';