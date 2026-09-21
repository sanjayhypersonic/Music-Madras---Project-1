import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type {
  FieldOwnershipState,
  SyncConflict,
  SyncConflictResolution,
  SyncProvider,
  SyncResourceType,
} from "@prisma/client";

// SyncConflict persistence (Phase 6B, ADR §16.3). Creation is a routine,
// system-detected event (not audit-logged, matching the same
// system-vs-human split used in fieldOwnershipRepository.ts); resolving a
// conflict is a human decision and is always audit-logged — ADR §16.3:
// "resolutions are never silent." This module never decides whether a
// change constitutes a conflict — that judgment belongs to the
// (not-yet-built) sync engine.

export interface CreateSyncConflictInput {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  resourceId: string;
  fieldName: string;
  ownershipAtDetection: FieldOwnershipState;
  previousMusicMadrasValue: string | null;
  newProviderValue: string | null;
  reason?: string;
  syncJobRunId?: string;
}

export function createSyncConflict(input: CreateSyncConflictInput): Promise<SyncConflict> {
  return prisma.syncConflict.create({ data: input });
}

export interface ResolveSyncConflictInput {
  resolution: SyncConflictResolution;
  resolvedById: string;
}

export async function resolveSyncConflict(id: string, input: ResolveSyncConflictInput): Promise<SyncConflict> {
  const before = await prisma.syncConflict.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`SyncConflict ${id} does not exist.`);
  }

  const resolved = await prisma.syncConflict.update({
    where: { id },
    data: {
      status: "RESOLVED",
      resolution: input.resolution,
      resolvedById: input.resolvedById,
      resolvedAt: new Date(),
    },
  });

  await writeAuditLog({
    actorId: input.resolvedById,
    action: "SYNC_CONFLICT_RESOLVED",
    entityType: before.resourceType,
    entityId: before.resourceId,
    beforeSnapshot: { fieldName: before.fieldName, status: before.status },
    afterSnapshot: { fieldName: before.fieldName, status: "RESOLVED", resolution: input.resolution },
  });

  return resolved;
}

export async function ignoreSyncConflict(id: string, actorId: string): Promise<SyncConflict> {
  const before = await prisma.syncConflict.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`SyncConflict ${id} does not exist.`);
  }

  const ignored = await prisma.syncConflict.update({
    where: { id },
    data: { status: "IGNORED", resolvedById: actorId, resolvedAt: new Date() },
  });

  await writeAuditLog({
    actorId,
    action: "SYNC_CONFLICT_IGNORED",
    entityType: before.resourceType,
    entityId: before.resourceId,
    beforeSnapshot: { fieldName: before.fieldName, status: before.status },
    afterSnapshot: { fieldName: before.fieldName, status: "IGNORED" },
  });

  return ignored;
}

export function findSyncConflictById(id: string): Promise<SyncConflict | null> {
  return prisma.syncConflict.findUnique({ where: { id } });
}

export function listOpenSyncConflicts(): Promise<SyncConflict[]> {
  return prisma.syncConflict.findMany({ where: { status: "OPEN" }, orderBy: { detectedAt: "asc" } });
}
