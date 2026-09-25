import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { isSupportedProvenanceEntityType, UnsupportedProvenanceEntityTypeError } from "../../mmke/provenance/provenanceEntityType";
import type { ProvenanceEntityType } from "../../mmke/provenance/provenanceEntityType";
import type { EntityRights, RightsInformation } from "@prisma/client";

// Repository foundation for RightsInformation (Phase 6G-13) — activates
// the existing prisma/schema.prisma RightsInformation/EntityRights models,
// unchanged.
//
// RightsInformation already has ONE working attachment path in this
// codebase: a MediaResource's own direct `rightsInformationId` FK, wired
// up via mediaResourceRepository.ts's attachRightsToMedia — that is for
// rights belonging to one specific media asset, and is untouched by this
// phase. EntityRights (below) is the separate, existing generic join for
// rights that belong to an entity itself (e.g. a MusicalWork's overall
// copyright status), independent of any one Recording/MediaResource of
// it — see the model's own schema comment.
//
// Like Source, RightsInformation has no archivedAt and no createdById/
// updatedById columns in the existing schema. This repository never makes
// a legal interpretation or infers rights — every field is exactly what
// an authorized Studio user explicitly entered.

export interface CreateRightsInformationInput {
  holder?: string;
  licenseType?: string;
  notes?: string;
  actorId: string;
}

export async function createRightsInformation(input: CreateRightsInformationInput): Promise<RightsInformation> {
  const rights = await prisma.rightsInformation.create({
    data: { holder: input.holder, licenseType: input.licenseType, notes: input.notes },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "RIGHTS_INFORMATION_CREATED",
    entityType: "RightsInformation",
    entityId: rights.id,
    afterSnapshot: rights,
  });

  return rights;
}

export function findRightsInformationById(id: string): Promise<RightsInformation | null> {
  return prisma.rightsInformation.findUnique({ where: { id } });
}

/** Every RightsInformation record, with an optional case-insensitive filter across holder/licenseType. */
export function listRightsInformation(searchQuery?: string): Promise<RightsInformation[]> {
  return prisma.rightsInformation.findMany({
    where: searchQuery
      ? {
          OR: [
            { holder: { contains: searchQuery, mode: "insensitive" } },
            { licenseType: { contains: searchQuery, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdateRightsInformationInput {
  holder?: string | null;
  licenseType?: string | null;
  notes?: string | null;
  actorId: string;
}

export async function updateRightsInformation(id: string, input: UpdateRightsInformationInput): Promise<RightsInformation> {
  const before = await prisma.rightsInformation.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`RightsInformation ${id} does not exist.`);
  }

  const updated = await prisma.rightsInformation.update({
    where: { id },
    data: { holder: input.holder, licenseType: input.licenseType, notes: input.notes },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "RIGHTS_INFORMATION_UPDATED",
    entityType: "RightsInformation",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Attachment (EntityRights) — activates the existing generic polymorphic
// join, following the same shape EntityOccasion/EntitySource established.
// ---------------------------------------------------------------------------

export function listRightsForEntity(
  entityType: ProvenanceEntityType,
  entityId: string
): Promise<(EntityRights & { rightsInformation: RightsInformation })[]> {
  return prisma.entityRights.findMany({
    where: { entityType, entityId },
    include: { rightsInformation: true },
  });
}

export interface AttachRightsInformationInput {
  entityType: string;
  entityId: string;
  rightsInformationId: string;
  actorId: string;
}

/**
 * Attaches a RightsInformation record to an entity.
 *
 * - Only the V1-supported entity types may be attached.
 * - No archived/inactive check applies: RightsInformation has no
 *   archivedAt column in the existing schema.
 * - Duplicate attachment is prevented by an application-layer check, for
 *   the same reason documented in sourceRepository.ts's
 *   attachSourceToEntity (EntityRights has no @@unique constraint in the
 *   existing schema; adding one is a migration this phase avoids).
 */
export async function attachRightsInformationToEntity(input: AttachRightsInformationInput): Promise<EntityRights> {
  if (!isSupportedProvenanceEntityType(input.entityType)) {
    throw new UnsupportedProvenanceEntityTypeError(input.entityType);
  }

  const rights = await prisma.rightsInformation.findUnique({ where: { id: input.rightsInformationId } });
  if (!rights) {
    throw new Error(`RightsInformation ${input.rightsInformationId} does not exist.`);
  }

  const existingLink = await prisma.entityRights.findFirst({
    where: { entityType: input.entityType, entityId: input.entityId, rightsInformationId: input.rightsInformationId },
  });
  if (existingLink) {
    throw new Error(`This Rights Information is already attached to this ${input.entityType.toLowerCase()}.`);
  }

  const link = await prisma.entityRights.create({
    data: { entityType: input.entityType, entityId: input.entityId, rightsInformationId: input.rightsInformationId },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "RIGHTS_INFORMATION_ATTACHED",
    entityType: input.entityType,
    entityId: input.entityId,
    afterSnapshot: { rightsInformationId: input.rightsInformationId },
  });

  return link;
}

export async function detachRightsInformationFromEntity(
  entityType: string,
  entityId: string,
  rightsInformationId: string,
  actorId: string
): Promise<void> {
  const existing = await prisma.entityRights.findFirst({ where: { entityType, entityId, rightsInformationId } });
  if (!existing) {
    throw new Error(`No Rights Information attachment found for ${entityType} ${entityId} / RightsInformation ${rightsInformationId}.`);
  }

  await prisma.entityRights.delete({ where: { id: existing.id } });

  await writeAuditLog({
    actorId,
    action: "RIGHTS_INFORMATION_DETACHED",
    entityType,
    entityId,
    beforeSnapshot: { rightsInformationId },
  });
}
