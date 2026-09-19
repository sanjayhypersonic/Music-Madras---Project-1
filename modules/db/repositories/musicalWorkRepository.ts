import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import type { MusicalWork } from "@prisma/client";

export interface CreateMusicalWorkInput {
  slug: string;
  title: string;
  composerId: string;
  alternateTitles?: string[];
  language?: string;
  notes?: string;
  catalogueNumber?: string;
  keySignature?: string;
  actorId: string;
}

/**
 * A duplicate check scoped to the same composer, not the whole catalogue —
 * two different composers may legitimately share a work title (e.g. many
 * composers wrote a "Magnificat"), but the same composer having the same
 * work title twice is almost certainly a duplicate entry.
 */
export async function createMusicalWork(input: CreateMusicalWorkInput): Promise<MusicalWork> {
  const existing = await prisma.musicalWork.findMany({
    where: { composerId: input.composerId, archivedAt: null },
    select: { title: true },
  });

  const duplicate = findExactNormalizedDuplicate(
    input.title,
    existing.map((w) => w.title)
  );
  if (duplicate) {
    throw new DuplicateEntityError("MusicalWork", duplicate);
  }

  const work = await prisma.musicalWork.create({
    data: {
      slug: input.slug,
      title: input.title,
      composerId: input.composerId,
      alternateTitles: input.alternateTitles ?? [],
      language: input.language,
      notes: input.notes,
      catalogueNumber: input.catalogueNumber,
      keySignature: input.keySignature,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "MUSICAL_WORK_CREATED",
    entityType: "MusicalWork",
    entityId: work.id,
    afterSnapshot: work,
  });

  return work;
}

export function findMusicalWorkById(id: string): Promise<MusicalWork | null> {
  return prisma.musicalWork.findUnique({ where: { id } });
}

export function findMusicalWorkBySlug(slug: string): Promise<MusicalWork | null> {
  return prisma.musicalWork.findUnique({ where: { slug } });
}

export function listMusicalWorksByComposer(composerId: string): Promise<MusicalWork[]> {
  return prisma.musicalWork.findMany({
    where: { composerId, archivedAt: null },
    orderBy: { title: "asc" },
  });
}

export async function archiveMusicalWork(id: string, actorId: string): Promise<MusicalWork> {
  const work = await prisma.musicalWork.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "MUSICAL_WORK_ARCHIVED",
    entityType: "MusicalWork",
    entityId: id,
  });

  return work;
}
