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
