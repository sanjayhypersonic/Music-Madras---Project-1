-- Phase 6G-9: Artist, Choir, and Conductor each need a stable, unique,
-- human-readable URL slug so they can have their own public
-- /artists|choirs|conductors/[slug] routes, mirroring every other public
-- entity (Composer, MusicalWork, Venue, Programme, Recording, Performance).
-- Added as a safe three-step expand migration per table since existing
-- rows may already exist and must be backfilled before the NOT NULL/
-- UNIQUE constraints are enforced.
--
-- Unlike Performance (Phase 6G-8), these three entities already have a
-- real human-typed `name` field, so the backfill slug is derived from
-- `name` alone (lowercased, hyphenated the same way
-- modules/mmke/slug/slugify.ts does it) — but with this row's own id
-- (first 8 hex characters) appended as a uniqueness suffix, because a
-- one-shot SQL backfill across pre-existing rows cannot safely resolve
-- two rows sharing (or nearly sharing) the same name the way a Studio
-- editor can interactively at create time. Every NEW row created going
-- forward (via createArtist/createChoir/createConductor) gets a clean
-- slugify(name)-only slug instead, exactly like Composer/Venue, with a
-- SlugConflictError surfaced to the editor on collision.

-- ============================================================
-- Artist
-- ============================================================
ALTER TABLE "artists" ADD COLUMN "slug" TEXT;

UPDATE "artists" a
SET "slug" = sub.computed_slug
FROM (
  SELECT
    id,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(id, 1, 8) AS computed_slug
  FROM "artists"
) sub
WHERE a.id = sub.id;

ALTER TABLE "artists" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "artists_slug_key" ON "artists"("slug");

-- ============================================================
-- Choir
-- ============================================================
ALTER TABLE "choirs" ADD COLUMN "slug" TEXT;

UPDATE "choirs" c
SET "slug" = sub.computed_slug
FROM (
  SELECT
    id,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(id, 1, 8) AS computed_slug
  FROM "choirs"
) sub
WHERE c.id = sub.id;

ALTER TABLE "choirs" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "choirs_slug_key" ON "choirs"("slug");

-- ============================================================
-- Conductor
-- ============================================================
ALTER TABLE "conductors" ADD COLUMN "slug" TEXT;

UPDATE "conductors" cn
SET "slug" = sub.computed_slug
FROM (
  SELECT
    id,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(id, 1, 8) AS computed_slug
  FROM "conductors"
) sub
WHERE cn.id = sub.id;

ALTER TABLE "conductors" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "conductors_slug_key" ON "conductors"("slug");
