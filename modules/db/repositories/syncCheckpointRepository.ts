import { prisma } from "../client";
import type { Prisma, SyncCheckpoint, SyncCompleteness, SyncProvider, SyncResourceType } from "@prisma/client";

// SyncCheckpoint persistence (Phase 6B, ADR §13.2) — one row per
// (provider, resourceType, scopeKey), where scopeKey is the generic
// analogue of the ADR's "(resourceType, parentId)" (e.g. a specific
// playlist's id, or a fixed sentinel like "channel-uploads"). Routine
// sync-engine bookkeeping, not a human action, so not audit-logged —
// matches the same routine-vs-consequential split used throughout this
// phase's other repositories.

export interface UpsertSyncCheckpointInput {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  scopeKey: string;
  pageToken?: string | null;
  lastProcessedId?: string | null;
  etag?: string | null;
  lastFullCompletionAt?: Date | null;
  completeness?: SyncCompleteness | null;
  providerCursor?: Prisma.InputJsonValue;
  syncJobRunId?: string | null;
}

export function upsertSyncCheckpoint(input: UpsertSyncCheckpointInput): Promise<SyncCheckpoint> {
  const { provider, resourceType, scopeKey, ...rest } = input;
  const create: Prisma.SyncCheckpointUncheckedCreateInput = { provider, resourceType, scopeKey, ...rest };
  const update: Prisma.SyncCheckpointUncheckedUpdateInput = { ...rest };
  return prisma.syncCheckpoint.upsert({
    where: { provider_resourceType_scopeKey: { provider, resourceType, scopeKey } },
    create,
    update,
  });
}

export function findSyncCheckpoint(
  provider: SyncProvider,
  resourceType: SyncResourceType,
  scopeKey: string
): Promise<SyncCheckpoint | null> {
  return prisma.syncCheckpoint.findUnique({ where: { provider_resourceType_scopeKey: { provider, resourceType, scopeKey } } });
}

export function listSyncCheckpoints(provider: SyncProvider, resourceType: SyncResourceType): Promise<SyncCheckpoint[]> {
  return prisma.syncCheckpoint.findMany({ where: { provider, resourceType } });
}
