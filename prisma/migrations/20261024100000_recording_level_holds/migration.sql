-- Recording-level holds (project register R-20): an explicit, recorded decision to withhold a Recording from the public Museum,
-- independent of its publication state and of any hold on its videos.
-- Additive only: one enum and four nullable columns on "recordings". No existing row changes (every Recording starts un-held); no data is moved.
-- The four columns are set together or all null, enforced by a CHECK. History (who imposed it, who lifted it, when, why) is the audit log.
-- Applied only to the isolated loopback test database; never to production.

-- CreateEnum
CREATE TYPE "RecordingHoldReason" AS ENUM ('RIGHTS', 'COPYRIGHT', 'PRIVACY', 'OTHER');

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "holdNote" TEXT,
ADD COLUMN     "holdReason" "RecordingHoldReason",
ADD COLUMN     "holdSetAt" TIMESTAMP(3),
ADD COLUMN     "holdSetById" TEXT;

-- AddForeignKey
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_holdSetById_fkey" FOREIGN KEY ("holdSetById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A hold has a reason and a time together, or neither (no half-recorded hold can exist).
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_hold_consistent_check" CHECK (("holdReason" IS NULL) = ("holdSetAt" IS NULL));
