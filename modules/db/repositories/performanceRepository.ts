import { randomUUID } from "crypto";
import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { generatePerformanceSlug } from "../../mmke/slug/generatePerformanceSlug";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { Performance, Prisma, Programme, Venue } from "@prisma/client";

// Performance links a Programme to a Venue and its participants (brief §3,
// §6) via explicit join tables — never free-text participant names.

export interface CreatePerformanceInput {
  programmeId: string;
  venueId: string;
  performanceDate?: Date;
  actorId: string;
}

/**
 * Phase 6G-8: Performance now has its own public /performances/[slug]
 * route, so every new row needs a slug. Unlike Composer/MusicalWork/
 * Venue/Programme (where the Studio action computes `slugify(name)` and
 * passes it in, since the editor already typed that name), a Performance
 * has no name field of its own — its slug is derived here, from its own
 * Programme/Venue/date, via generatePerformanceSlug (see that module for
 * why this is collision-safe by construction). The id is generated
 * up front, before the insert, purely so the slug can include it as its
 * uniqueness suffix. The try/catch below is defense-in-depth only (kept
 * for consistency with every other slugged entity's create function) —
 * an id-suffixed slug colliding with another row is not expected in
 * practice.
 */
export async function createPerformance(
  input: CreatePerformanceInput,
  /** Phase 6J-10C — optional caller-owned transaction, so a Performance created for a draft is atomic with linking it. */
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Performance> {
  const [programme, venue] = await Promise.all([
    client.programme.findUnique({ where: { id: input.programmeId } }),
    client.venue.findUnique({ where: { id: input.venueId } }),
  ]);
  if (!programme) {
    throw new Error(`Programme ${input.programmeId} does not exist.`);
  }
  if (!venue) {
    throw new Error(`Venue ${input.venueId} does not exist.`);
  }

  const id = randomUUID();
  const slug = generatePerformanceSlug({
    programmeTitle: programme.title,
    venueName: venue.name,
    performanceDate: input.performanceDate ?? null,
    performanceId: id,
  });

  let performance: Performance;
  try {
    performance = await client.performance.create({
      data: {
        id,
        slug,
        programmeId: input.programmeId,
        venueId: input.venueId,
        performanceDate: input.performanceDate,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(slug);
    }
    throw err;
  }

  await writeAuditLog(
    {
      actorId: input.actorId,
      action: "PERFORMANCE_CREATED",
      entityType: "Performance",
      entityId: performance.id,
      afterSnapshot: performance,
    },
    client
  );

  return performance;
}

/**
 * Links an Artist to a Performance with an optional role label (brief §6
 * — "Soloist", "Organist", etc.). Upserts so re-adding the same artist
 * only updates their role rather than erroring on the composite key.
 */
export async function addPerformerToPerformance(
  performanceId: string,
  artistId: string,
  role: string | undefined,
  actorId: string
) {
  const link = await prisma.performancePerformer.upsert({
    where: { performanceId_artistId: { performanceId, artistId } },
    create: { performanceId, artistId, role },
    update: { role },
  });

  await writeAuditLog({
    actorId,
    action: "PERFORMER_LINKED_TO_PERFORMANCE",
    entityType: "Performance",
    entityId: performanceId,
    afterSnapshot: { artistId, role },
  });

  return link;
}

export async function removePerformerFromPerformance(
  performanceId: string,
  artistId: string,
  actorId: string
): Promise<void> {
  await prisma.performancePerformer.delete({
    where: { performanceId_artistId: { performanceId, artistId } },
  });

  await writeAuditLog({
    actorId,
    action: "PERFORMER_UNLINKED_FROM_PERFORMANCE",
    entityType: "Performance",
    entityId: performanceId,
    beforeSnapshot: { artistId },
  });
}

export async function addChoirToPerformance(performanceId: string, choirId: string, actorId: string) {
  const link = await prisma.performanceChoir.upsert({
    where: { performanceId_choirId: { performanceId, choirId } },
    create: { performanceId, choirId },
    update: {},
  });

  await writeAuditLog({
    actorId,
    action: "CHOIR_LINKED_TO_PERFORMANCE",
    entityType: "Performance",
    entityId: performanceId,
    afterSnapshot: { choirId },
  });

  return link;
}

export async function removeChoirFromPerformance(performanceId: string, choirId: string, actorId: string): Promise<void> {
  await prisma.performanceChoir.delete({
    where: { performanceId_choirId: { performanceId, choirId } },
  });

  await writeAuditLog({
    actorId,
    action: "CHOIR_UNLINKED_FROM_PERFORMANCE",
    entityType: "Performance",
    entityId: performanceId,
    beforeSnapshot: { choirId },
  });
}

export async function addConductorToPerformance(
  performanceId: string,
  conductorId: string,
  actorId: string
) {
  const link = await prisma.performanceConductor.upsert({
    where: { performanceId_conductorId: { performanceId, conductorId } },
    create: { performanceId, conductorId },
    update: {},
  });

  await writeAuditLog({
    actorId,
    action: "CONDUCTOR_LINKED_TO_PERFORMANCE",
    entityType: "Performance",
    entityId: performanceId,
    afterSnapshot: { conductorId },
  });

  return link;
}

export async function removeConductorFromPerformance(
  performanceId: string,
  conductorId: string,
  actorId: string
): Promise<void> {
  await prisma.performanceConductor.delete({
    where: { performanceId_conductorId: { performanceId, conductorId } },
  });

  await writeAuditLog({
    actorId,
    action: "CONDUCTOR_UNLINKED_FROM_PERFORMANCE",
    entityType: "Performance",
    entityId: performanceId,
    beforeSnapshot: { conductorId },
  });
}

export function findPerformanceById(id: string) {
  return prisma.performance.findUnique({
    where: { id },
    include: {
      programme: { include: { items: { include: { musicalWork: true }, orderBy: { order: "asc" } } } },
      venue: true,
      performers: { include: { artist: true } },
      choirs: { include: { choir: true } },
      conductors: { include: { conductor: true } },
    },
  });
}

export interface PerformanceForStudio extends Performance {
  programme: Programme;
  venue: Venue;
  _count: { performers: number; choirs: number; conductors: number };
}

/**
 * Studio-facing list (Phase 6G-4H, mirrors listProgrammesForStudio): every
 * Performance regardless of archived state, with Programme/Venue joined
 * (a Performance has no name of its own — the list is meaningless without
 * them) and cheap direct-relation participant counts. Search matches
 * either the linked Programme's title or the linked Venue's name, since
 * neither exists as a field on Performance itself.
 */
export function listPerformancesForStudio(searchQuery?: string): Promise<PerformanceForStudio[]> {
  return prisma.performance.findMany({
    where: searchQuery
      ? {
          OR: [
            { programme: { title: { contains: searchQuery, mode: "insensitive" } } },
            { venue: { name: { contains: searchQuery, mode: "insensitive" } } },
          ],
        }
      : undefined,
    include: {
      programme: true,
      venue: true,
      _count: { select: { performers: true, choirs: true, conductors: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdatePerformanceInput {
  performanceDate?: Date | null;
  actorId: string;
}

/**
 * Edits the Performance's own fields — currently just performanceDate.
 * Deliberately never accepts `programmeId`/`venueId` here; those
 * relationship changes go through reassignPerformanceProgramme/
 * reassignPerformanceVenue below, each with its own distinct audit event
 * (same convention as changeMusicalWorkComposer / linkVenueToOrganisation).
 */
export async function updatePerformance(id: string, input: UpdatePerformanceInput): Promise<Performance> {
  const before = await prisma.performance.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Performance ${id} does not exist.`);
  }

  const updated = await prisma.performance.update({
    where: { id },
    data: {
      performanceDate: input.performanceDate,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "PERFORMANCE_UPDATED",
    entityType: "Performance",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Reassigns which canonical Programme this Performance belongs to — a
 * distinct relationship operation from editing the Performance's own
 * fields, gets its own audit action (brief: "Programme
 * assignment/reassignment").
 */
export async function reassignPerformanceProgramme(id: string, programmeId: string, actorId: string): Promise<Performance> {
  const before = await prisma.performance.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Performance ${id} does not exist.`);
  }

  const programme = await prisma.programme.findUnique({ where: { id: programmeId } });
  if (!programme) {
    throw new Error(`Programme ${programmeId} does not exist.`);
  }

  const updated = await prisma.performance.update({
    where: { id },
    data: { programmeId, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "PERFORMANCE_PROGRAMME_CHANGED",
    entityType: "Performance",
    entityId: id,
    beforeSnapshot: { programmeId: before.programmeId },
    afterSnapshot: { programmeId },
  });

  return updated;
}

/**
 * Reassigns which Venue this Performance took place at — same pattern as
 * reassignPerformanceProgramme above (brief: "Venue
 * assignment/reassignment").
 */
export async function reassignPerformanceVenue(id: string, venueId: string, actorId: string): Promise<Performance> {
  const before = await prisma.performance.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Performance ${id} does not exist.`);
  }

  const venue = await prisma.venue.findUnique({ where: { id: venueId } });
  if (!venue) {
    throw new Error(`Venue ${venueId} does not exist.`);
  }

  const updated = await prisma.performance.update({
    where: { id },
    data: { venueId, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "PERFORMANCE_VENUE_CHANGED",
    entityType: "Performance",
    entityId: id,
    beforeSnapshot: { venueId: before.venueId },
    afterSnapshot: { venueId },
  });

  return updated;
}

/**
 * Archiving/restoring reuses the existing archivedAt convention — never
 * deletes the row, never cascades to participant links or the linked
 * Programme/Venue.
 */
export async function archivePerformance(id: string, actorId: string): Promise<Performance> {
  const performance = await prisma.performance.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "PERFORMANCE_ARCHIVED",
    entityType: "Performance",
    entityId: id,
  });

  return performance;
}

export async function restorePerformance(id: string, actorId: string): Promise<Performance> {
  const performance = await prisma.performance.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "PERFORMANCE_RESTORED",
    entityType: "Performance",
    entityId: id,
  });

  return performance;
}
