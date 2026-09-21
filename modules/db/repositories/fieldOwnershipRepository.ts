import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { FieldOwnership, FieldOwnershipState, SyncProvider, SyncResourceType } from "@prisma/client";

// Field-level ownership persistence (Phase 6B, ADR §16.1) — one row per
// (provider, resourceType, resourceId, fieldName). This module only
// stores what it is told; it never decides *when* a field should change
// ownership or what a sync should do about a conflict — that judgment
// belongs to the (not-yet-built) sync engine and Studio resolution
// screen. Two write functions, split by who is acting:
//
// - recordExternalFieldValue: the sync engine touching lastExternalValue/
//   lastSyncedAt on a routine, successful field sync. Never changes
//   `ownership` itself, and is not audit-logged — routine, bot-driven
//   observations aren't meaningful actorial events, matching how
//   YouTubeAnalyticsObservation upserts aren't individually audited
//   either.
// - setFieldOwnership: an explicit ownership-state change (a field
//   entering the system for the first time, an editor overriding a
//   synced value, or a conflict resolution accepting the external
//   value). Always audit-logged — ADR §16.3: "resolutions are never
//   silent."

export interface RecordExternalFieldValueInput {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  resourceId: string;
  fieldName: string;
  externalValue: string | null;
  observedAt: Date;
}

export async function recordExternalFieldValue(input: RecordExternalFieldValueInput): Promise<FieldOwnership> {
  return prisma.fieldOwnership.upsert({
    where: {
      provider_resourceType_resourceId_fieldName: {
        provider: input.provider,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        fieldName: input.fieldName,
      },
    },
    create: {
      provider: input.provider,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      fieldName: input.fieldName,
      lastExternalValue: input.externalValue,
      lastSyncedAt: input.observedAt,
    },
    update: {
      lastExternalValue: input.externalValue,
      lastSyncedAt: input.observedAt,
    },
  });
}

export interface SetFieldOwnershipInput {
  provider: SyncProvider;
  resourceType: SyncResourceType;
  resourceId: string;
  fieldName: string;
  ownership: FieldOwnershipState;
  editorialValue?: string | null;
  actorId: string | null;
}

export async function setFieldOwnership(input: SetFieldOwnershipInput): Promise<FieldOwnership> {
  const before = await prisma.fieldOwnership.findUnique({
    where: {
      provider_resourceType_resourceId_fieldName: {
        provider: input.provider,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        fieldName: input.fieldName,
      },
    },
  });

  const updated = await prisma.fieldOwnership.upsert({
    where: {
      provider_resourceType_resourceId_fieldName: {
        provider: input.provider,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        fieldName: input.fieldName,
      },
    },
    create: {
      provider: input.provider,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      fieldName: input.fieldName,
      ownership: input.ownership,
      lastEditorialValue: input.editorialValue ?? undefined,
      changedById: input.actorId ?? undefined,
    },
    update: {
      ownership: input.ownership,
      lastEditorialValue: input.editorialValue ?? undefined,
      ownershipChangedAt: new Date(),
      changedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "FIELD_OWNERSHIP_CHANGED",
    entityType: input.resourceType,
    entityId: input.resourceId,
    beforeSnapshot: before ? { fieldName: before.fieldName, ownership: before.ownership } : null,
    afterSnapshot: { fieldName: input.fieldName, ownership: input.ownership },
  });

  return updated;
}

export function findFieldOwnership(
  provider: SyncProvider,
  resourceType: SyncResourceType,
  resourceId: string,
  fieldName: string
): Promise<FieldOwnership | null> {
  return prisma.fieldOwnership.findUnique({
    where: { provider_resourceType_resourceId_fieldName: { provider, resourceType, resourceId, fieldName } },
  });
}

export function listFieldOwnershipsForResource(
  resourceType: SyncResourceType,
  resourceId: string
): Promise<FieldOwnership[]> {
  return prisma.fieldOwnership.findMany({ where: { resourceType, resourceId } });
}
