-- Phase 6K lifecycle hardening, migration 3 of 4: database-level guarantees.
--
--   1. At most one ACTIVE approval per (page, scope, playlist page).               (raw SQL partial unique index)
--   2. Featured positions are unique.                                              (Prisma-modelled unique index)
--   3. Playlist-item positions are unique per playlist page.                        (Prisma-modelled unique index)
--   4. A playlist page's published snapshot carries its member notes, and its published title is unique among live pages
--      (`publishedTitleKey`, set only while published and not archived).            (columns + Prisma-modelled unique index)
--
-- Duplicates are CHECKED FIRST. If any exist, the migration stops with a message naming the problem and changes nothing: it never deletes or
-- rewrites a record to make an index fit. Resolve the duplicates in Studio (or with a reviewed one-off statement) and run the migration again.
-- Reordering code renumbers in two phases (see featuredVideoRepository.ts and playlistPageRepository.ts), so a legitimate multi-row reorder never
-- trips the position indexes.
--
-- RAW SQL, outside the Prisma schema: `video_exposure_approvals_one_active_target_key`. Prisma cannot express a partial (WHERE ...) or expression
-- index, so it is not declared in schema.prisma. Lifecycle: created here and enforced by PostgreSQL; a fresh `prisma migrate deploy` re-creates it;
-- the application still serialises approvals with a row lock on the page, so this index is the backstop for any other writer (scripts, manual SQL).
-- The playlist-page title key is derived exactly as normaliseTitle() does in code (collapse whitespace, trim, lower-case).
--
-- Additive, and idempotent in its data step (the backfill only fills NULL keys). No down-migration is needed to roll back safely: dropping the
-- indexes would be a separate, deliberate change.

-- Pre-flight checks -----------------------------------------------------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "video_exposure_approvals" WHERE "revokedAt" IS NULL
    GROUP BY "videoPageId", "scope", COALESCE("playlistPageId", '') HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot create the active-approval uniqueness index: some video page has more than one active approval for the same scope. Revoke the extras (keep the earliest) and run this migration again. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM "featured_videos" GROUP BY "position" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Cannot make featured positions unique: two featured videos share a position. Renumber them 1..n and run this migration again. Nothing was changed.';
  END IF;
  IF EXISTS (SELECT 1 FROM "playlist_page_items" GROUP BY "playlistPageId", "position" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Cannot make playlist-item positions unique: a playlist page has two members at one position. Renumber its members 1..n and run this migration again. Nothing was changed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "playlist_pages"
    WHERE "status" = 'PUBLISHED' AND "archivedAt" IS NULL AND "publishedTitle" IS NOT NULL
    GROUP BY lower(btrim(regexp_replace("publishedTitle", '\s+', ' ', 'g'))) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot make published playlist titles unique: two live playlist pages share a published title. Unpublish or retitle one and run this migration again. Nothing was changed.';
  END IF;
END
$$;

-- AlterTable
ALTER TABLE "playlist_pages" ADD COLUMN     "publishedMemberNotes" JSONB,
ADD COLUMN     "publishedTitleKey" TEXT;

-- Data step: the title key of every page that is live now.
UPDATE "playlist_pages"
SET "publishedTitleKey" = lower(btrim(regexp_replace("publishedTitle", '\s+', ' ', 'g')))
WHERE "status" = 'PUBLISHED' AND "archivedAt" IS NULL AND "publishedTitle" IS NOT NULL AND "publishedTitleKey" IS NULL;

-- DropIndex (replaced by the unique indexes below)
DROP INDEX "featured_videos_position_idx";

-- DropIndex
DROP INDEX "playlist_page_items_playlistPageId_position_idx";

-- CreateIndex
CREATE UNIQUE INDEX "featured_videos_position_key" ON "featured_videos"("position");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_page_items_playlistPageId_position_key" ON "playlist_page_items"("playlistPageId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "playlist_pages_publishedTitleKey_key" ON "playlist_pages"("publishedTitleKey");

-- Raw SQL: at most one active approval per (page, scope, playlist page).
CREATE UNIQUE INDEX "video_exposure_approvals_one_active_target_key" ON "video_exposure_approvals"("videoPageId", "scope", COALESCE("playlistPageId", '')) WHERE "revokedAt" IS NULL;
