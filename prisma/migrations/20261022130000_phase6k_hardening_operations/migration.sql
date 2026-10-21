-- Phase 6K lifecycle hardening, migration 4 of 4: reliable email delivery and observable scheduled maintenance.
--
--   1. Notification deliveries gain a CLAIM (claimedUntil, claimToken, requeueAfterClaim) and a non-sensitive last-error record (lastError,
--      lastErrorAt), so overlapping workers cannot ordinarily send one delivery twice, a failure is never silent, and re-raising a notification
--      cannot delete a delivery a worker is sending.
--   2. Durable state for the stewardship job: runs, per-step results, and a named lease so overlapping invocations cannot run it twice at once.
--
-- Purely additive: new nullable/defaulted columns and three new tables; no existing row changes and nothing is rewritten. No scheduler or hosting is
-- configured by this; whatever calls /api/cron/stewardship now leaves a record. Delivery stays at-least-once (documented in the runbook).

-- CreateEnum
CREATE TYPE "StewardshipRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "StewardshipStepStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "studio_notification_deliveries" ADD COLUMN     "claimToken" TEXT,
ADD COLUMN     "claimedUntil" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "lastErrorAt" TIMESTAMP(3),
ADD COLUMN     "requeueAfterClaim" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "stewardship_runs" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "StewardshipRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "stewardship_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stewardship_step_runs" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "status" "StewardshipStepStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "counts" JSONB,
    "errorKind" TEXT,
    "errorSummary" TEXT,

    CONSTRAINT "stewardship_step_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stewardship_leases" (
    "name" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stewardship_leases_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "stewardship_runs_startedAt_idx" ON "stewardship_runs"("startedAt");

-- CreateIndex
CREATE INDEX "stewardship_step_runs_runId_idx" ON "stewardship_step_runs"("runId");

-- CreateIndex
CREATE INDEX "stewardship_step_runs_step_startedAt_idx" ON "stewardship_step_runs"("step", "startedAt");

-- AddForeignKey
ALTER TABLE "stewardship_step_runs" ADD CONSTRAINT "stewardship_step_runs_runId_fkey" FOREIGN KEY ("runId") REFERENCES "stewardship_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
