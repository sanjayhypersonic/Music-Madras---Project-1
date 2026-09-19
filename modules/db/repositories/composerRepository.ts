import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import type { Composer } from "@prisma/client";

// Repository foundation for Composer — a simple direct-edit entity (ADR
// §4), not part of the Draft/Revision model. Demonstrates the module
// boundary (only modules/db imports Prisma) and Phase 2's duplicate-name
// guard (brief §42) — the fuzzy/similarity part of duplicate detection is
// still deferred; see modules/mmke/duplicate-detection/README.md.

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
  const existing = await prisma.composer.findMany({
    where: { archivedAt: null },
    select: { name: true },
  });

  const duplicate = findExactNormalizedDuplicate(
    input.name,
    existing.map((c) => c.name)
  );
  if (duplicate) {
    throw new DuplicateEntityError("Composer", duplicate);
  }

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
