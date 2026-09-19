import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { Performance } from "@prisma/client";

// Performance links a Programme to a Venue and its participants (brief §3,
// §6) via explicit join tables — never free-text participant names.

export interface CreatePerformanceInput {
  programmeId: string;
  venueId: string;
  performanceDate?: Date;
  actorId: string;
}

export async function createPerformance(input: CreatePerformanceInput): Promise<Performance> {
  const performance = await prisma.performance.create({
    data: {
      programmeId: input.programmeId,
      venueId: input.venueId,
      performanceDate: input.performanceDate,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "PERFORMANCE_CREATED",
    entityType: "Performance",
    entityId: performance.id,
    afterSnapshot: performance,
  });

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
