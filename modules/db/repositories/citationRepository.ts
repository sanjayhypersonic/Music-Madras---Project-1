import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import type { Citation } from "@prisma/client";

// Repository foundation for Citation (Phase 6G-13) — activates the
// existing prisma/schema.prisma Citation model, unchanged.
//
// Citation is distinct from Source: a Source is where material
// originated; a Citation is a specific piece of evidence/reference that
// may optionally point at one. Citation has NO relationship to Composer/
// MusicalWork/Recording directly — the schema only ever relates it to
// Source (`Citation.sourceId`) — so Citation is managed as a child of a
// Source in the Studio, never attached to an entity on its own. This
// mirrors the schema exactly; no EntityCitation join exists, and none is
// added here.
//
// Like Source, Citation has no archivedAt and no createdById/updatedById
// columns in the existing schema — `actorId` is used only for the audit
// log entry, never persisted on the row.

export interface CreateCitationInput {
  text?: string;
  sourceId?: string;
  actorId: string;
}

export async function createCitation(input: CreateCitationInput): Promise<Citation> {
  if (input.sourceId) {
    const source = await prisma.source.findUnique({ where: { id: input.sourceId } });
    if (!source) {
      throw new Error(`Source ${input.sourceId} does not exist.`);
    }
  }

  const citation = await prisma.citation.create({
    data: { text: input.text, sourceId: input.sourceId },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "CITATION_CREATED",
    entityType: "Citation",
    entityId: citation.id,
    afterSnapshot: citation,
  });

  return citation;
}

export function findCitationById(id: string): Promise<Citation | null> {
  return prisma.citation.findUnique({ where: { id } });
}

/** Every Citation belonging to one Source — Citation's only real relationship. */
export function listCitationsForSource(sourceId: string): Promise<Citation[]> {
  return prisma.citation.findMany({ where: { sourceId }, orderBy: { createdAt: "desc" } });
}

export interface UpdateCitationInput {
  text?: string | null;
  sourceId?: string | null;
  actorId: string;
}

export async function updateCitation(id: string, input: UpdateCitationInput): Promise<Citation> {
  const before = await prisma.citation.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Citation ${id} does not exist.`);
  }

  if (input.sourceId) {
    const source = await prisma.source.findUnique({ where: { id: input.sourceId } });
    if (!source) {
      throw new Error(`Source ${input.sourceId} does not exist.`);
    }
  }

  const updated = await prisma.citation.update({
    where: { id },
    data: { text: input.text, sourceId: input.sourceId },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "CITATION_UPDATED",
    entityType: "Citation",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}
