import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { Composer } from "@prisma/client";

// Minimal repository foundation for Composer — a simple direct-edit entity
// (ADR §4), not part of the Draft/Revision model. This demonstrates the
// module boundary (only modules/db imports Prisma) without implementing
// Studio-facing business functionality such as duplicate detection, which
// belongs to a later phase (ADR §4, brief §42) and lives in modules/mmke.

export interface CreateComposerInput {
  slug: string;
  name: string;
  bornDate?: string;
  diedDate?: string;
  era?: string;
  biography?: string;
  actorId: string;
}

export async function createComposer(input: CreateComposerInput): Promise<Composer> {
  const composer = await prisma.composer.create({
    data: {
      slug: input.slug,
      name: input.name,
      bornDate: input.bornDate,
      diedDate: input.diedDate,
      era: input.era,
      biography: input.biography,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "COMPOSER_CREATED",
    entityType: "Composer",
    entityId: composer.id,
    afterSnapshot: composer,
  });

  return composer;
}

export function findComposerById(id: string): Promise<Composer | null> {
  return prisma.composer.findUnique({ where: { id } });
}

export function findComposerBySlug(slug: string): Promise<Composer | null> {
  return prisma.composer.findUnique({ where: { slug } });
}

export function listActiveComposers(): Promise<Composer[]> {
  return prisma.composer.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
  });
}
