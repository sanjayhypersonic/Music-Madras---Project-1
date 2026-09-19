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
