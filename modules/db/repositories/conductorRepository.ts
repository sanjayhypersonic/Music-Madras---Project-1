import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import type { Conductor } from "@prisma/client";

export interface CreateConductorInput {
  name: string;
  biography?: string;
  actorId: string;
}

export async function createConductor(input: CreateConductorInput): Promise<Conductor> {
  const existing = await prisma.conductor.findMany({ where: { archivedAt: null }, select: { name: true } });
  const duplicate = findExactNormalizedDuplicate(input.name, existing.map((c) => c.name));
  if (duplicate) {
    throw new DuplicateEntityError("Conductor", duplicate);
  }

  const conductor = await prisma.conductor.create({
    data: {
      name: input.name,
      biography: input.biography,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "CONDUCTOR_CREATED",
    entityType: "Conductor",
    entityId: conductor.id,
    afterSnapshot: conductor,
  });

  return conductor;
}

export function findConductorById(id: string): Promise<Conductor | null> {
  return prisma.conductor.findUnique({ where: { id } });
}

export function listActiveConductors(): Promise<Conductor[]> {
  return prisma.conductor.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" } });
}

/** Studio-facing list (Phase 6G-4F, mirrors listArtistsForStudio). */
export function listConductorsForStudio(searchQuery?: string): Promise<Conductor[]> {
  return prisma.conductor.findMany({
    where: searchQuery ? { name: { contains: searchQuery, mode: "insensitive" } } : undefined,
    orderBy: { name: "asc" },
  });
}

export interface UpdateConductorInput {
  name?: string;
  biography?: string | null;
  actorId: string;
}

/** Edits the canonical Conductor record in place — mirrors updateArtist exactly. */
export async function updateConductor(id: string, input: UpdateConductorInput): Promise<Conductor> {
  const before = await prisma.conductor.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Conductor ${id} does not exist.`);
  }

  const updated = await prisma.conductor.update({
    where: { id },
    data: {
      name: input.name,
      biography: input.biography,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "CONDUCTOR_UPDATED",
    entityType: "Conductor",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

export async function archiveConductor(id: string, actorId: string): Promise<Conductor> {
  const conductor = await prisma.conductor.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "CONDUCTOR_ARCHIVED",
    entityType: "Conductor",
    entityId: id,
  });

  return conductor;
}

export async function restoreConductor(id: string, actorId: string): Promise<Conductor> {
  const conductor = await prisma.conductor.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "CONDUCTOR_RESTORED",
    entityType: "Conductor",
    entityId: id,
  });

  return conductor;
}
