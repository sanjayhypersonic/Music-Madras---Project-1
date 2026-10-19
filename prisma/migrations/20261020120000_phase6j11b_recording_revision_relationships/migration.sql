-- Phase 6J-11B: revision-scoped Recording relationships (foundation).
--
-- Additive and inert: three NEW tables (a revision's sources, rights information and occasions), their composite
-- primary keys, indexes and foreign keys. No existing table or column is altered, renamed or dropped, no row is
-- written, and nothing reads these tables yet — public pages and the Studio keep using the legacy Recording-level
-- entity_sources / entity_rights / entity_occasions rows, which are untouched. Existing recording_revisions rows need
-- no change (a revision simply has no rows here until it is forked from, or edited after, this phase's code ships).
--
-- Delete behaviour: the revision foreign key CASCADEs (a revision's links go with it); the Source / RightsInformation /
-- Occasion foreign keys are RESTRICT (a catalogue record a revision uses cannot be deleted from under it). Duplicate
-- links are impossible (composite primary keys); orphan links are impossible (foreign keys).
--
-- Rollout: apply before deploying the code that uses the tables; rolling the code back leaves the (empty or populated)
-- tables harmless. No backfill is part of this migration.
-- CreateTable
CREATE TABLE "recording_revision_sources" (
    "revisionId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_revision_sources_pkey" PRIMARY KEY ("revisionId","sourceId")
);

-- CreateTable
CREATE TABLE "recording_revision_rights" (
    "revisionId" TEXT NOT NULL,
    "rightsInformationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_revision_rights_pkey" PRIMARY KEY ("revisionId","rightsInformationId")
);

-- CreateTable
CREATE TABLE "recording_revision_occasions" (
    "revisionId" TEXT NOT NULL,
    "occasionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recording_revision_occasions_pkey" PRIMARY KEY ("revisionId","occasionId")
);

-- CreateIndex
CREATE INDEX "recording_revision_sources_sourceId_idx" ON "recording_revision_sources"("sourceId");

-- CreateIndex
CREATE INDEX "recording_revision_rights_rightsInformationId_idx" ON "recording_revision_rights"("rightsInformationId");

-- CreateIndex
CREATE INDEX "recording_revision_occasions_occasionId_idx" ON "recording_revision_occasions"("occasionId");

-- AddForeignKey
ALTER TABLE "recording_revision_sources" ADD CONSTRAINT "recording_revision_sources_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "recording_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_sources" ADD CONSTRAINT "recording_revision_sources_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_rights" ADD CONSTRAINT "recording_revision_rights_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "recording_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_rights" ADD CONSTRAINT "recording_revision_rights_rightsInformationId_fkey" FOREIGN KEY ("rightsInformationId") REFERENCES "rights_information"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_occasions" ADD CONSTRAINT "recording_revision_occasions_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "recording_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recording_revision_occasions" ADD CONSTRAINT "recording_revision_occasions_occasionId_fkey" FOREIGN KEY ("occasionId") REFERENCES "occasions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
