import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import type { Choir } from "@prisma/client";

export interface CreateChoirInput {
  name: string;
  directorName?: string;
  description?: string;
  actorId: string;
}

export async function createChoir(input: CreateChoirInput): Promise<Choir> {
  const existing = await prisma.choir.findMany({ where: { archivedAt: null }, select: { name: true } });
  const duplicate = findExactNormalizedDuplicate(input.name, existing.map((c) => c.name));
  if (duplicate) {
    throw new DuplicateEntityError("Choir", duplicate);
  }

  const choir = await prisma.choir.create({
    data: {
      name: input.name,
      directorName: input.directorName,
      description: input.description,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "CHOIR_CREATED",
    entityType: "Choir",
    entityId: choir.id,
    afterSnapshot: choir,
  });

  return choir;
}

export function findChoirById(id: string): Promise<Choir | null> {
  return prisma.choir.findUnique({ where: { id } });
}

export function listActiveChoirs(): Promise<Choir[]> {
  return prisma.choir.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } });
}

/** Studio-facing list (Phase 6G-4F, mirrors listArtistsForStudio). */
export function listChoirsForStudio(searchQuery?: string): Promise<Choir[]> {
  return prisma.choir.findMany({
    where: searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
  });
}

export interface UpdateChoirInput {
  name?: string;
  directorName?: string | null;
  description?: string | null;
  actorId: string;
}

/** Edits the canonical Choir record in place — mirrors updateArtist exactly. */
export async function updateChoir(id: string, input: UpdateChoirInput): Promise<Choir> {
  const before = await prisma.choir.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Choir ${id} does not exist.`);
  }

  const updated = await prisma.choir.update({
    where: { id },
    data: {
      name: input.name,
      directorName: input.directorName,
      description: input.description,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "CHOIR_UPDATED",
    entityType: "Choir",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

export async function archiveChoir(id: string, actorId: string): Promise<Choir> {
  const choir = await prisma.choir.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "CHOIR_ARCHIVED",
    entityType: "Choir",
    entityId: id,
  });

  return choir;
}

export async function restoreChoir(id: string, actorId: string): Promise<Choir> {
  const choir = await prisma.choir.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "CHOIR_RESTORED",
    entityType: "Choir",
    entityId: id,
  });

  return choir;
}
