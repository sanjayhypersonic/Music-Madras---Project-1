-- Upload-to-draft pipeline (project register R-34, docs/upload-pipeline.md). WRITTEN, NOT APPLIED (2026-11-18).
-- Purely additive: new enums and tables; nullable personId on composers, conductors and artists; tags and hashtags (default empty)
-- on youtube_videos. No existing column is changed or dropped and no row is rewritten. Generated with `prisma migrate diff`
-- from the committed schema to the new one. Apply only through the guarded procedure (docs/runbooks/production-launch.md section 3).

-- CreateEnum
CREATE TYPE "WorkContributorRole" AS ENUM ('ARRANGER', 'LYRICIST', 'TRANSLATOR');

-- CreateEnum
CREATE TYPE "PipelineEntityKind" AS ENUM ('COMPOSER', 'WORK', 'CONDUCTOR', 'CHOIR', 'ARTIST', 'VENUE', 'ENSEMBLE', 'PERSON', 'ORGANISATION');

-- CreateEnum
CREATE TYPE "PipelineVideoStatus" AS ENUM ('QUEUED', 'EXTRACTED', 'RESOLVED', 'RESEARCHED', 'AWAITING_APPROVAL', 'APPROVED', 'PUBLISHED', 'REJECTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "PipelineClaimStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'CONFLICT', 'STALE');

-- CreateEnum
CREATE TYPE "PipelineSourceTier" AS ENUM ('A', 'B', 'C', 'X');

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'STOPPED_COST_CAP');

-- CreateEnum
CREATE TYPE "EntityPageCopyStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- AlterTable
ALTER TABLE "composers" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "artists" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "conductors" ADD COLUMN     "personId" TEXT;

-- AlterTable
ALTER TABLE "youtube_videos" ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "persons" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "biography" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "musical_work_contributors" (
    "musicalWorkId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "WorkContributorRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "musical_work_contributors_pkey" PRIMARY KEY ("musicalWorkId","personId","role")
);

-- CreateTable
CREATE TABLE "ensembles" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "ensembles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_ensembles" (
    "performanceId" TEXT NOT NULL,
    "ensembleId" TEXT NOT NULL,

    CONSTRAINT "performance_ensembles_pkey" PRIMARY KEY ("performanceId","ensembleId")
);

-- CreateTable
CREATE TABLE "entity_aliases" (
    "id" TEXT NOT NULL,
    "entityKind" "PipelineEntityKind" NOT NULL,
    "alias" TEXT NOT NULL,
    "aliasKey" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "entityId" TEXT,
    "source" TEXT NOT NULL,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "status" "PipelineRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3) NOT NULL,
    "videosConsidered" INTEGER NOT NULL DEFAULT 0,
    "videosAdvanced" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "webSearches" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "costCapUsd" DECIMAL(10,4) NOT NULL,
    "stoppedReason" TEXT,
    "steps" JSONB,

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_videos" (
    "id" TEXT NOT NULL,
    "youtubeVideoRowId" TEXT NOT NULL,
    "status" "PipelineVideoStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceFingerprint" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorKind" TEXT,
    "extraction" JSONB,
    "resolution" JSONB,
    "research" JSONB,
    "draft" JSONB,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "recordingId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_claims" (
    "id" TEXT NOT NULL,
    "pipelineVideoId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "entityKind" "PipelineEntityKind",
    "entityId" TEXT,
    "entityName" TEXT NOT NULL,
    "subjectKind" TEXT NOT NULL,
    "workTitle" TEXT,
    "value" TEXT,
    "statement" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceTitle" TEXT,
    "excerpt" TEXT NOT NULL,
    "sourceTier" "PipelineSourceTier" NOT NULL,
    "videoRelation" TEXT NOT NULL,
    "status" "PipelineClaimStatus" NOT NULL DEFAULT 'PROPOSED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_page_copies" (
    "id" TEXT NOT NULL,
    "entityKind" "PipelineEntityKind" NOT NULL,
    "entityId" TEXT NOT NULL,
    "seoTitle" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "keyFacts" JSONB NOT NULL,
    "sameAs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceClaimIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "EntityPageCopyStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_page_copies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "persons_slug_key" ON "persons"("slug");

-- CreateIndex
CREATE INDEX "persons_archivedAt_idx" ON "persons"("archivedAt");

-- CreateIndex
CREATE INDEX "musical_work_contributors_personId_idx" ON "musical_work_contributors"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "ensembles_slug_key" ON "ensembles"("slug");

-- CreateIndex
CREATE INDEX "ensembles_archivedAt_idx" ON "ensembles"("archivedAt");

-- CreateIndex
CREATE INDEX "performance_ensembles_ensembleId_idx" ON "performance_ensembles"("ensembleId");

-- CreateIndex
CREATE UNIQUE INDEX "entity_aliases_entityKind_aliasKey_key" ON "entity_aliases"("entityKind", "aliasKey");

-- CreateIndex
CREATE INDEX "pipeline_runs_startedAt_idx" ON "pipeline_runs"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_videos_youtubeVideoRowId_key" ON "pipeline_videos"("youtubeVideoRowId");

-- CreateIndex
CREATE INDEX "pipeline_videos_status_idx" ON "pipeline_videos"("status");

-- CreateIndex
CREATE INDEX "pipeline_claims_pipelineVideoId_idx" ON "pipeline_claims"("pipelineVideoId");

-- CreateIndex
CREATE INDEX "pipeline_claims_entityKind_entityName_idx" ON "pipeline_claims"("entityKind", "entityName");

-- CreateIndex
CREATE UNIQUE INDEX "entity_page_copies_entityKind_entityId_key" ON "entity_page_copies"("entityKind", "entityId");

-- AddForeignKey
ALTER TABLE "composers" ADD CONSTRAINT "composers_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artists" ADD CONSTRAINT "artists_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conductors" ADD CONSTRAINT "conductors_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persons" ADD CONSTRAINT "persons_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "musical_work_contributors" ADD CONSTRAINT "musical_work_contributors_musicalWorkId_fkey" FOREIGN KEY ("musicalWorkId") REFERENCES "musical_works"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "musical_work_contributors" ADD CONSTRAINT "musical_work_contributors_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ensembles" ADD CONSTRAINT "ensembles_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ensembles" ADD CONSTRAINT "ensembles_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "studio_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_ensembles" ADD CONSTRAINT "performance_ensembles_performanceId_fkey" FOREIGN KEY ("performanceId") REFERENCES "performances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_ensembles" ADD CONSTRAINT "performance_ensembles_ensembleId_fkey" FOREIGN KEY ("ensembleId") REFERENCES "ensembles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_videos" ADD CONSTRAINT "pipeline_videos_youtubeVideoRowId_fkey" FOREIGN KEY ("youtubeVideoRowId") REFERENCES "youtube_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_videos" ADD CONSTRAINT "pipeline_videos_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_claims" ADD CONSTRAINT "pipeline_claims_pipelineVideoId_fkey" FOREIGN KEY ("pipelineVideoId") REFERENCES "pipeline_videos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_claims" ADD CONSTRAINT "pipeline_claims_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_page_copies" ADD CONSTRAINT "entity_page_copies_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

