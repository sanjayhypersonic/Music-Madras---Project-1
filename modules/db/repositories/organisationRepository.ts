import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { Organisation } from "@prisma/client";

export interface CreateOrganisationInput {
  name: string;
  description?: string;
  actorId: string;
}

export async function createOrganisation(input: CreateOrganisationInput): Promise<Organisation> {
  const organisation = await prisma.organisation.create({
    data: {
      name: input.name,
      description: input.description,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "ORGANISATION_CREATED",
    entityType: "Organisation",
    entityId: organisation.id,
    afterSnapshot: organisation,
  });

  return organisation;
}

export function findOrganisationById(id: string): Promise<Organisation | null> {
  return prisma.organisation.findUnique({ where: { id } });
}

export function listActiveOrganisations(): Promise<Organisation[]> {
  return prisma.organisation.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
}
