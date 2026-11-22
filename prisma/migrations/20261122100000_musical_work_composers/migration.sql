-- Co-composers (project register R-36, 2026-11-22). WRITTEN, NOT APPLIED.
-- A musical work may have several composers in a stated order. New table musical_work_composers (one row per work and composer, with its
-- position); musical_works."composerId" is KEPT as the primary composer (position 1), so every existing reader keeps working. Additive: a new
-- table, its indexes and foreign keys, then a BACKFILL that gives every existing work its primary composer at position 1 (no existing row is
-- changed). Generated with `prisma migrate diff` from the committed schema to the new one; the backfill is hand-written. Apply only through the
-- guarded procedure (docs/runbooks/upload-pipeline-staging-checklist.md, Part A).

-- CreateTable
CREATE TABLE "musical_work_composers" (
    "workId" TEXT NOT NULL,
    "composerId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "musical_work_composers_pkey" PRIMARY KEY ("workId","composerId")
);

-- CreateIndex
CREATE INDEX "musical_work_composers_composerId_idx" ON "musical_work_composers"("composerId");

-- CreateIndex
CREATE INDEX "musical_work_composers_workId_position_idx" ON "musical_work_composers"("workId", "position");

-- AddForeignKey
ALTER TABLE "musical_work_composers" ADD CONSTRAINT "musical_work_composers_workId_fkey" FOREIGN KEY ("workId") REFERENCES "musical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "musical_work_composers" ADD CONSTRAINT "musical_work_composers_composerId_fkey" FOREIGN KEY ("composerId") REFERENCES "composers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill: every existing work gets its primary composer (musical_works."composerId") at position 1. Idempotent (ON CONFLICT DO NOTHING).
INSERT INTO "musical_work_composers" ("workId", "composerId", "position")
SELECT "id", "composerId", 1 FROM "musical_works"
ON CONFLICT ("workId", "composerId") DO NOTHING;
