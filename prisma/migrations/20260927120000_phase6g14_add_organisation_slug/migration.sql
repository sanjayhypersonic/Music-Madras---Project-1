-- Phase 6G-14: Organisation needs a stable, unique, human-readable URL
-- slug so it can have its own public /organisations/[slug] route,
-- mirroring every other public entity (Composer, Venue, Artist, Choir,
-- Conductor, Programme, Recording, Performance). Added as a safe
-- three-step expand migration since existing rows may already exist and
-- must be backfilled before the NOT NULL/UNIQUE constraints are enforced.
--
-- Organisation already has a real human-typed `name` field (like Artist/
-- Choir/Conductor in Phase 6G-9, unlike Performance in Phase 6G-8), so
-- the backfill slug is derived from `name` alone (lowercased, hyphenated
-- the same way modules/mmke/slug/slugify.ts does it) — but with this
-- row's own id (first 8 hex characters) appended as a deterministic
-- uniqueness suffix, because a one-shot SQL backfill across pre-existing
-- rows cannot safely resolve two rows sharing (or nearly sharing) the
-- same name the way a Studio editor can interactively at create time.
-- Every NEW row created going forward (via createOrganisation) gets a
-- clean slugify(name)-only slug instead, exactly like Composer/Venue,
-- with a SlugConflictError surfaced to the editor on collision.

ALTER TABLE "organisations" ADD COLUMN "slug" TEXT;

UPDATE "organisations" o
SET "slug" = sub.computed_slug
FROM (
  SELECT
    id,
    trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || substr(id, 1, 8) AS computed_slug
  FROM "organisations"
) sub
WHERE o.id = sub.id;

ALTER TABLE "organisations" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "organisations_slug_key" ON "organisations"("slug");
