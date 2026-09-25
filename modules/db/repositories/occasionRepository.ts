import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { isSupportedOccasionEntityType, UnsupportedOccasionEntityTypeError } from "../../mmke/occasion/occasionEntityType";
import type { OccasionEntityType } from "../../mmke/occasion/occasionEntityType";
import type { EntityOccasion, Occasion } from "@prisma/client";

// Repository foundation for Occasion (Phase 6G-12) — a simple direct-edit
// entity, following the exact Composer pattern: not part of the Draft/
// Revision model, same duplicate-name guard, same slug-conflict handling,
// same archive/restore semantics. See prisma/schema.prisma's Occasion
// model comment for why this is distinct from Collection.

export interface CreateOccasionInput {
  slug: string;
  name: string;
  description?: string;
  actorId: string;
}

export async function createOccasion(input: CreateOccasionInput): Promise<Occasion> {
  const existing = await prisma.occasion.findMany({
    where: { archivedAt: null },
    select: { name: true },
  });

  const duplicate = findExactNormalizedDuplicate(
    input.name,
    existing.map((o) => o.name)
  );
  if (duplicate) {
    throw new DuplicateEntityError("Occasion", duplicate);
  }

  let occasion: Occasion;
  try {
    occasion = await prisma.occasion.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(input.slug);
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: "OCCASION_CREATED",
    entityType: "Occasion",
    entityId: occasion.id,
    afterSnapshot: occasion,
  });

  return occasion;
}

export function findOccasionById(id: string): Promise<Occasion | null> {
  return prisma.occasion.findUnique({ where: { id } });
}

export function findOccasionBySlug(slug: string): Promise<Occasion | null> {
  return prisma.occasion.findUnique({ where: { slug } });
}

/** Non-archived only — the set a Studio picker should offer for new attachments. */
export function listActiveOccasions(): Promise<Occasion[]> {
  return prisma.occasion.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
}

/**
 * Studio-facing list: every Occasion regardless of archived state, with an
 * optional case-insensitive name filter — mirrors listComposersForStudio
 * exactly. Satisfies both "listOccasions" (no query) and "searchOccasions"
 * (with a query) from a single flexible function, the same shape Composer
 * itself uses rather than two parallel functions.
 */
export function listOccasionsForStudio(searchQuery?: string): Promise<Occasion[]> {
  return prisma.occasion.findMany({
    where: searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
  });
}

export interface UpdateOccasionInput {
  name?: string;
  description?: string | null;
  actorId: string;
}

/**
 * Edits the canonical Occasion record in place — deliberately never
 * accepts `slug`: an immutable slug, same rationale as updateComposer, so
 * an ordinary name edit never silently regenerates (and breaks) an
 * existing attachment's stable identity.
 */
export async function updateOccasion(id: string, input: UpdateOccasionInput): Promise<Occasion> {
  const before = await prisma.occasion.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Occasion ${id} does not exist.`);
  }

  const updated = await prisma.occasion.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "OCCASION_UPDATED",
    entityType: "Occasion",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Archiving/restoring reuses the existing archivedAt convention every
 * other simple entity already has — never deletes the row, never touches
 * EntityOccasion. An archived Occasion is excluded from
 * listActiveOccasions (so it can't be newly attached), but every existing
 * EntityOccasion attachment referencing it remains fully intact and
 * resolvable via listOccasionsForEntity.
 */
export async function archiveOccasion(id: string, actorId: string): Promise<Occasion> {
  const occasion = await prisma.occasion.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "OCCASION_ARCHIVED",
    entityType: "Occasion",
    entityId: id,
  });

  return occasion;
}

export async function restoreOccasion(id: string, actorId: string): Promise<Occasion> {
  const occasion = await prisma.occasion.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "OCCASION_RESTORED",
    entityType: "Occasion",
    entityId: id,
  });

  return occasion;
}

// ---------------------------------------------------------------------------
// Attachment (EntityOccasion) — the generic polymorphic join, mirroring
// EntitySource/EntityRights/EntityEducationalContent's established shape.
// ---------------------------------------------------------------------------

export function listOccasionsForEntity(
  entityType: OccasionEntityType,
  entityId: string
): Promise<(EntityOccasion & { occasion: Occasion })[]> {
  return prisma.entityOccasion.findMany({
    where: { entityType, entityId },
    include: { occasion: true },
  });
}

export interface AttachOccasionInput {
  entityType: string;
  entityId: string;
  occasionId: string;
  actorId: string;
}

/**
 * Attaches an Occasion to an entity.
 *
 * - Only the V1-supported entity types may be attached (validated at the
 *   application layer via isSupportedOccasionEntityType — never a database
 *   enum, so growing this set later needs no migration).
 * - Only an ACTIVE (non-archived) Occasion may be NEWLY attached — this is
 *   re-checked here rather than trusted from the caller, since a Studio
 *   picker only ever offers active Occasions but a stale form submission
 *   could still name one that was archived in the meantime.
 * - Duplicate attachment is prevented by the database's own
 *   @@unique([entityType, entityId, occasionId]) constraint, never a
 *   second, race-prone pre-check query.
 */
export async function attachOccasionToEntity(input: AttachOccasionInput): Promise<EntityOccasion> {
  if (!isSupportedOccasionEntityType(input.entityType)) {
    throw new UnsupportedOccasionEntityTypeError(input.entityType);
  }

  const occasion = await prisma.occasion.findUnique({ where: { id: input.occasionId } });
  if (!occasion) {
    throw new Error(`Occasion ${input.occasionId} does not exist.`);
  }
  if (occasion.archivedAt) {
    throw new Error(`Occasion "${occasion.name}" is archived and cannot be newly attached.`);
  }

  let link: EntityOccasion;
  try {
    link = await prisma.entityOccasion.create({
      data: { entityType: input.entityType, entityId: input.entityId, occasionId: input.occasionId },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      throw new Error(`"${occasion.name}" is already attached to this ${input.entityType.toLowerCase()}.`);
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: "OCCASION_ATTACHED",
    entityType: input.entityType,
    entityId: input.entityId,
    afterSnapshot: { occasionId: input.occasionId, occasionName: occasion.name },
  });

  return link;
}

export async function detachOccasionFromEntity(
  entityType: string,
  entityId: string,
  occasionId: string,
  actorId: string
): Promise<void> {
  const existing = await prisma.entityOccasion.findFirst({
    where: { entityType, entityId, occasionId },
    include: { occasion: true },
  });
  if (!existing) {
    throw new Error(`No Occasion attachment found for ${entityType} ${entityId} / Occasion ${occasionId}.`);
  }

  await prisma.entityOccasion.delete({ where: { id: existing.id } });

  await writeAuditLog({
    actorId,
    action: "OCCASION_DETACHED",
    entityType,
    entityId,
    beforeSnapshot: { occasionId, occasionName: existing.occasion.name },
  });
}
