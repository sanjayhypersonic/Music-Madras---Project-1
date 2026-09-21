import { prisma } from "../client";
import type { SyncCompleteness, SyncJobRun, SyncJobStatus, SyncProvider } from "@prisma/client";

// SyncJobRun persistence (Phase 6B, ADR §12-13) — one row per actual
// synchronization attempt, scheduled or manual alike (both will call the
// same job function in a later phase, so both write this same row
// shape). Routine sync-engine bookkeeping, not audit-logged individually
// — matches YouTubeAnalyticsObservation's own upsert, which isn't
// audit-logged either (see docs/analytics-architecture.md §7).
//
// This module does not decide completeness or status — the (not-yet-
// built) sync engine determines those from its own reconciliation
// outcome and passes them to completeSyncJobRun.

export function startSyncJobRun(provider: SyncProvider, jobType: string): Promise<SyncJobRun> {
  return prisma.syncJobRun.create({ data: { provider, jobType } });
}

export interface CompleteSyncJobRunInput {
  status: SyncJobStatus;
  completeness: SyncCompleteness;
  recordsDiscovered?: number;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsUnchanged?: number;
  recordsFlagged?: number;
  recordsFailed?: number;
  conflictsDetected?: number;
  errorDetails?: string;
}

export function completeSyncJobRun(id: string, input: CompleteSyncJobRunInput): Promise<SyncJobRun> {
  return prisma.syncJobRun.update({
    where: { id },
    data: { ...input, completedAt: new Date() },
  });
}

export function findSyncJobRunById(id: string): Promise<SyncJobRun | null> {
  return prisma.syncJobRun.findUnique({ where: { id } });
}

export function listRecentSyncJobRuns(limit = 20): Promise<SyncJobRun[]> {
  return prisma.syncJobRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
}

/**
 * The evidence rule ADR §15 depends on: only FULL-completeness runs may
 * ever count toward a deletion/unavailability escalation. Exposed here as
 * a small persistence-layer query so the (not-yet-built) availability
 * logic never has to hand-roll the `completeness: "FULL"` filter itself.
 */
export function listFullSyncJobRunsSince(provider: SyncProvider, since: Date): Promise<SyncJobRun[]> {
  return prisma.syncJobRun.findMany({
    where: { provider, completeness: "FULL", startedAt: { gte: since } },
    orderBy: { startedAt: "asc" },
  });
}
