-- Operational incidents (project register R-15, first slice): a deduplicated, counted record of integrity problems the platform detects and works around.
-- Additive only: two enums and one table. Nothing free-form is stored (kind enum, bounded reason code, entity type code + internal id).
-- Generated with `prisma migrate diff` against the isolated loopback test database; applied only there.

-- CreateEnum
CREATE TYPE "OperationalIncidentKind" AS ENUM ('ORGANISATION_PAGE_RECORDING_OMITTED');

-- CreateEnum
CREATE TYPE "OperationalIncidentStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "operational_incidents" (
    "id" TEXT NOT NULL,
    "kind" "OperationalIncidentKind" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" "OperationalIncidentStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCode" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedReason" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),

    CONSTRAINT "operational_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "operational_incidents_status_lastSeenAt_idx" ON "operational_incidents"("status", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "operational_incidents_kind_fingerprint_key" ON "operational_incidents"("kind", "fingerprint");

-- AddForeignKey
ALTER TABLE "operational_incidents" ADD CONSTRAINT "operational_incidents_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
