-- Phase 6G-8: Performance needs a stable, unique, human-readable URL slug
-- so it can have its own public /performances/[slug] route, mirroring
-- every other public entity (Composer, MusicalWork, Venue, Programme,
-- Recording). Added as a safe three-step expand migration since existing
-- Performance rows may already exist and must be backfilled before the
-- NOT NULL/UNIQUE constraints are enforced.

-- Step 1: add the column as nullable first (safe for any existing rows).
ALTER TABLE "performances" ADD COLUMN "slug" TEXT;

-- Step 2: backfill every existing row deterministically from its own
-- canonical data only — this Performance's linked Programme title,
-- linked Venue name, and its own performanceDate (formatted YYYY-MM-DD
-- when present) — lowercased and hyphenated the same way
-- modules/mmke/slug/slugify.ts does, with this row's own id (first 8 hex
-- characters) appended as a stable uniqueness suffix. This mirrors
-- modules/mmke/slug/generateVideoSlug.ts's "content + immutable id"
-- shape, guaranteeing every backfilled slug is unique by construction
-- with no collision-retry logic needed. Never derived from YouTube
-- metadata, another entity's title, AI, or any other inferred data.
UPDATE "performances" p
SET "slug" = sub.computed_slug
FROM (
  SELECT
    perf.id,
    trim(both '-' from regexp_replace(
      lower(
        pr.title || ' ' || v.name ||
        COALESCE(' ' || to_char(perf."performanceDate", 'YYYY-MM-DD'), '')
      ),
      '[^a-z0-9]+', '-', 'g'
    )) || '-' || substr(perf.id, 1, 8) AS computed_slug
  FROM "performances" perf
  JOIN "programmes" pr ON pr.id = perf."programmeId"
  JOIN "venues" v ON v.id = perf."venueId"
) sub
WHERE p.id = sub.id;

-- Step 3: only now that every row has a value, enforce NOT NULL + UNIQUE.
ALTER TABLE "performances" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "performances_slug_key" ON "performances"("slug");
