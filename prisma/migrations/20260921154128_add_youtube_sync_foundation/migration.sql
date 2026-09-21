-- CreateEnum
CREATE TYPE "SyncProvider" AS ENUM ('YOUTUBE');

-- CreateEnum
CREATE TYPE "SyncResourceType" AS ENUM ('RECORDING', 'YOUTUBE_VIDEO', 'YOUTUBE_PLAYLIST', 'YOUTUBE_PLAYLIST_ITEM');

-- CreateEnum
CREATE TYPE "FieldOwnershipState" AS ENUM ('YOUTUBE_CONTROLLED', 'MUSIC_MADRAS_CONTROLLED', 'SHARED_REQUIRES_REVIEW');

-- CreateEnum
CREATE TYPE "SyncConflictStatus" AS ENUM ('OPEN', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SyncConflictResolution" AS ENUM ('KEPT_MUSIC_MADRAS', 'ACCEPTED_YOUTUBE', 'MANUAL_MERGE');

-- CreateEnum
CREATE TYPE "SyncCompleteness" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "field_ownerships" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "resourceType" "SyncResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "ownership" "FieldOwnershipState" NOT NULL DEFAULT 'YOUTUBE_CONTROLLED',
    "lastExternalValue" TEXT,
    "lastEditorialValue" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "ownershipChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_ownerships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_conflicts" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "resourceType" "SyncResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "ownershipAtDetection" "FieldOwnershipState" NOT NULL,
    "previousMusicMadrasValue" TEXT,
    "newProviderValue" TEXT,
    "status" "SyncConflictStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "SyncConflictResolution",
    "reason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "syncJobRunId" TEXT,

    CONSTRAINT "sync_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "observability_transitions" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "resourceType" "SyncResourceType" NOT NULL,
    "resourceId" TEXT NOT NULL,
    "musicMadrasEntityType" TEXT,
    "musicMadrasEntityId" TEXT,
    "fromState" "ObservabilityState" NOT NULL,
    "toState" "ObservabilityState" NOT NULL,
    "reason" TEXT NOT NULL,
    "requiredPasses" INTEGER,
    "syncJobRunId" TEXT,
    "syncCheckpointId" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observability_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_policies" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "resourceType" "SyncResourceType" NOT NULL,
    "deletionEvidenceRequiredPasses" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_checkpoints" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "resourceType" "SyncResourceType" NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "pageToken" TEXT,
    "lastProcessedId" TEXT,
    "etag" TEXT,
    "lastFullCompletionAt" TIMESTAMP(3),
    "completeness" "SyncCompleteness",
    "providerCursor" JSONB,
    "syncJobRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_job_runs" (
    "id" TEXT NOT NULL,
    "provider" "SyncProvider" NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'RUNNING',
    "completeness" "SyncCompleteness",
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "recordsDiscovered" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsUnchanged" INTEGER NOT NULL DEFAULT 0,
    "recordsFlagged" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "conflictsDetected" INTEGER NOT NULL DEFAULT 0,
    "errorDetails" TEXT,

    CONSTRAINT "sync_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "field_ownerships_resourceType_resourceId_idx" ON "field_ownerships"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "field_ownerships_provider_resourceType_resourceId_fieldName_key" ON "field_ownerships"("provider", "resourceType", "resourceId", "fieldName");

-- CreateIndex
CREATE INDEX "sync_conflicts_resourceType_resourceId_idx" ON "sync_conflicts"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "sync_conflicts_status_idx" ON "sync_conflicts"("status");

-- CreateIndex
CREATE INDEX "observability_transitions_resourceType_resourceId_idx" ON "observability_transitions"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "observability_transitions_toState_idx" ON "observability_transitions"("toState");

-- CreateIndex
CREATE UNIQUE INDEX "sync_policies_provider_resourceType_key" ON "sync_policies"("provider", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "sync_checkpoints_provider_resourceType_scopeKey_key" ON "sync_checkpoints"("provider", "resourceType", "scopeKey");

-- CreateIndex
CREATE INDEX "sync_job_runs_provider_status_idx" ON "sync_job_runs"("provider", "status");

-- CreateIndex
CREATE INDEX "sync_job_runs_startedAt_idx" ON "sync_job_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "field_ownerships" ADD CONSTRAINT "field_ownerships_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "studio_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_syncJobRunId_fkey" FOREIGN KEY ("syncJobRunId") REFERENCES "sync_job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observability_transitions" ADD CONSTRAINT "observability_transitions_syncJobRunId_fkey" FOREIGN KEY ("syncJobRunId") REFERENCES "sync_job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "observability_transitions" ADD CONSTRAINT "observability_transitions_syncCheckpointId_fkey" FOREIGN KEY ("syncCheckpointId") REFERENCES "sync_checkpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_checkpoints" ADD CONSTRAINT "sync_checkpoints_syncJobRunId_fkey" FOREIGN KEY ("syncJobRunId") REFERENCES "sync_job_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
