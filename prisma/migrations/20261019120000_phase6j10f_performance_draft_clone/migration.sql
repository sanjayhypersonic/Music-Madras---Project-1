-- Phase 6J-10F: copy-on-write clone marker for Performances.
--
-- Additive and backward compatible: two NULLABLE columns (the clone marker and the fingerprint of the original's
-- participants when the clone was made, used to refuse a conflicting promotion), an index and a SET NULL foreign key. Every existing row
-- keeps both columns NULL (an ordinary Performance), no data is rewritten, and code that predates this
-- column ignores it. Nothing is dropped or altered.
--
-- Rollout: apply this migration BEFORE deploying the code that reads/writes the column. Rolling the code back leaves
-- the column in place and harmless. Any clone rows created meanwhile are only ever referenced by an unpublished draft
-- revision and are never public (public eligibility requires a PUBLISHED revision).

-- AlterTable
ALTER TABLE "performances" ADD COLUMN     "draftBaseParticipantsKey" TEXT,
ADD COLUMN     "draftOfPerformanceId" TEXT;

-- CreateIndex
CREATE INDEX "performances_draftOfPerformanceId_idx" ON "performances"("draftOfPerformanceId");

-- AddForeignKey
ALTER TABLE "performances" ADD CONSTRAINT "performances_draftOfPerformanceId_fkey" FOREIGN KEY ("draftOfPerformanceId") REFERENCES "performances"("id") ON DELETE SET NULL ON UPDATE CASCADE;