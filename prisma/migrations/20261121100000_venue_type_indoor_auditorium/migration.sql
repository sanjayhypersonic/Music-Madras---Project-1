-- Venue type INDOOR_AUDITORIUM ("Indoor Auditorium"), alongside CHURCH, CATHEDRAL, CONCERT_HALL, STUDIO and OUTDOOR. WRITTEN, NOT APPLIED (2026-11-21).
-- Additive: one enum value, no data change; no existing venue is retyped. Generated with `prisma migrate diff` from the committed schema to the new
-- one (IF NOT EXISTS added, as in the earlier enum migrations, so a repeat is harmless). PostgreSQL does not allow using a new enum value in the
-- transaction that adds it, so nothing here uses it. Apply only through the guarded procedure (docs/runbooks/upload-pipeline-staging-checklist.md, Part A).

-- AlterEnum
ALTER TYPE "VenueType" ADD VALUE IF NOT EXISTS 'INDOOR_AUDITORIUM';
