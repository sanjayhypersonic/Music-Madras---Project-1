import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { isSupportedProvenanceEntityType, UnsupportedProvenanceEntityTypeError } from "../../mmke/provenance/provenanceEntityType";
import { canApproveSource, canDisableSource, canRejectSource } from "../../publishing/sourceApprovalTransitions";
import type { SourceApprovalStateValue } from "../../publishing/sourceApprovalTransitions";
import type { ProvenanceEntityType } from "../../mmke/provenance/provenanceEntityType";
import type { EntitySource, Source } from "@prisma/client";

// Repository foundation for Source (Phase 6G-13) — activates the existing
// prisma/schema.prisma Source/EntitySource models (ADR §4), unchanged.
//
// Source deliberately has no slug, no archivedAt, and no createdById/
// updatedById columns — this is the existing schema's own shape, not an
// omission introduced here. Consequences, all intentional:
// - No archive/restore is implemented (there is no field to hold that
//   state); Sources are simply created and edited in place.
// - No SlugConflictError-style collision handling applies (there is no
//   unique column to collide on).
// - `actorId` is used only for the audit log entry below, never persisted
//   on the Source row itself.
// - `title` is optional, so the duplicate-name guard (mirroring Composer's
//   findExactNormalizedDuplicate convention) only runs when a title is
//   actually given — a Source may legitimately be just a bare URL.

export interface CreateSourceInput {
  title?: string;
  url?: string;
  publisher?: string;
  actorId: string;
}

export async function createSource(input: CreateSourceInput): Promise<Source> {
  if (input.title) {
    const existing = await prisma.source.findMany({
      where: { title: { not: null } },
      select: { title: true },
    });
    const duplicate = findExactNormalizedDuplicate(
      input.title,
      existing.map((s) => s.title as string)
    );
    if (duplicate) {
      throw new Error(`A Source titled "${duplicate}" already exists. Use the existing record instead of creating a duplicate.`);
    }
  }

  const source = await prisma.source.create({
    data: { title: input.title, url: input.url, publisher: input.publisher },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "SOURCE_CREATED",
    entityType: "Source",
    entityId: source.id,
    afterSnapshot: source,
  });

  return source;
}

export function findSourceById(id: string): Promise<Source | null> {
  return prisma.source.findUnique({ where: { id } });
}

/** Every Source, with an optional case-insensitive filter across title/url/publisher. */
export function listSources(searchQuery?: string): Promise<Source[]> {
  return prisma.source.findMany({
    where: searchQuery
      ? {
          OR: [
            { title: { contains: searchQuery, mode: "insensitive" } },
            { url: { contains: searchQuery, mode: "insensitive" } },
            { publisher: { contains: searchQuery, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export interface UpdateSourceInput {
  title?: string | null;
  url?: string | null;
  publisher?: string | null;
  actorId: string;
}

export async function updateSource(id: string, input: UpdateSourceInput): Promise<Source> {
  const before = await prisma.source.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Source ${id} does not exist.`);
  }

  const updated = await prisma.source.update({
    where: { id },
    data: { title: input.title, url: input.url, publisher: input.publisher },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "SOURCE_UPDATED",
    entityType: "Source",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Trust/approval state (Phase 6H-8, docs/content-intelligence-architecture.md
// Phase 6H-8 section) — see modules/publishing/sourceApprovalTransitions.ts
// for the state machine itself. These are the ONLY functions that may
// change Source.approvalState; every transition is an explicit, authorized
// Studio action (never automatic) and is audited exactly like any other
// Source mutation.
// ---------------------------------------------------------------------------

export async function approveSource(id: string, actorId: string): Promise<Source> {
  const before = await prisma.source.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Source ${id} does not exist.`);
  }
  if (!canApproveSource(before.approvalState as SourceApprovalStateValue)) {
    throw new Error(`Source ${id} cannot be approved from its current approval state (${before.approvalState}).`);
  }

  const updated = await prisma.source.update({
    where: { id },
    data: { approvalState: "APPROVED", approvedById: actorId, approvedAt: new Date() },
  });

  await writeAuditLog({
    actorId,
    action: "SOURCE_APPROVED",
    entityType: "Source",
    entityId: id,
    beforeSnapshot: { approvalState: before.approvalState },
    afterSnapshot: { approvalState: updated.approvalState },
  });

  return updated;
}

export async function rejectSource(id: string, actorId: string): Promise<Source> {
  const before = await prisma.source.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Source ${id} does not exist.`);
  }
  if (!canRejectSource(before.approvalState as SourceApprovalStateValue)) {
    throw new Error(`Source ${id} cannot be rejected from its current approval state (${before.approvalState}).`);
  }

  const updated = await prisma.source.update({
    where: { id },
    data: { approvalState: "REJECTED" },
  });

  await writeAuditLog({
    actorId,
    action: "SOURCE_REJECTED",
    entityType: "Source",
    entityId: id,
    beforeSnapshot: { approvalState: before.approvalState },
    afterSnapshot: { approvalState: updated.approvalState },
  });

  return updated;
}

export async function disableSource(id: string, actorId: string): Promise<Source> {
  const before = await prisma.source.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Source ${id} does not exist.`);
  }
  if (!canDisableSource(before.approvalState as SourceApprovalStateValue)) {
    throw new Error(`Source ${id} cannot be disabled from its current approval state (${before.approvalState}).`);
  }

  const updated = await prisma.source.update({
    where: { id },
    data: { approvalState: "DISABLED" },
  });

  await writeAuditLog({
    actorId,
    action: "SOURCE_DISABLED",
    entityType: "Source",
    entityId: id,
    beforeSnapshot: { approvalState: before.approvalState },
    afterSnapshot: { approvalState: updated.approvalState },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Attachment (EntitySource) — activates the existing generic polymorphic
// join, following the same shape EntityOccasion/EntityEducationalContent
// already established.
// ---------------------------------------------------------------------------

export function listSourcesForEntity(
  entityType: ProvenanceEntityType,
  entityId: string
): Promise<(EntitySource & { source: Source })[]> {
  return prisma.entitySource.findMany({
    where: { entityType, entityId },
    include: { source: true },
  });
}

/**
 * Phase 6H-8 — the ONLY entry point the Recording Context Assembler may use
 * to read the Source registry for AI evidence
 * (recordingContextRepository.ts). Identical to listSourcesForEntity above
 * except filtered to approvalState: "APPROVED" — every other Studio-facing
 * caller of listSourcesForEntity (composer/work/relationships pages)
 * continues to see every attached Source regardless of approval state,
 * since approval only gates what may automatically become AI evidence,
 * never what a human editor can see in the Studio.
 *
 * Deliberately does NOT include Citation content: a Source's Citation text
 * is "Retrieved Source Material" in the Source Registry -> Source Retrieval
 * Adapter -> Retrieved Source Material pipeline (see
 * modules/ai/retrieval/sourceRetrievalAdapter.ts) — the assembler fetches it
 * through that adapter, not through this registry listing, keeping the two
 * concerns (which sources are trusted vs. what their current content is)
 * separate.
 */
export function listApprovedSourcesForEntity(
  entityType: ProvenanceEntityType,
  entityId: string
): Promise<(EntitySource & { source: Source })[]> {
  return prisma.entitySource.findMany({
    where: { entityType, entityId, source: { approvalState: "APPROVED" } },
    include: { source: true },
  });
}

export interface AttachSourceInput {
  entityType: string;
  entityId: string;
  sourceId: string;
  actorId: string;
}

/**
 * Attaches a Source to an entity.
 *
 * - Only the V1-supported entity types may be attached (validated at the
 *   application layer — never a database enum).
 * - No archived/inactive check applies here: Source has no archivedAt
 *   column in the existing schema, so there is no such state to guard
 *   against (brief §7's "where that is consistent with existing entity
 *   semantics" — for Source, it is not).
 * - Duplicate attachment is prevented by an application-layer check
 *   (EntitySource has no @@unique constraint in the existing schema, and
 *   adding one is a migration this phase deliberately avoids per brief
 *   §13 — this mirrors the same best-effort, non-atomic approach the
 *   codebase already uses for duplicate-name detection elsewhere, e.g.
 *   createComposer).
 */
export async function attachSourceToEntity(input: AttachSourceInput): Promise<EntitySource> {
  if (!isSupportedProvenanceEntityType(input.entityType)) {
    throw new UnsupportedProvenanceEntityTypeError(input.entityType);
  }

  const source = await prisma.source.findUnique({ where: { id: input.sourceId } });
  if (!source) {
    throw new Error(`Source ${input.sourceId} does not exist.`);
  }

  const existingLink = await prisma.entitySource.findFirst({
    where: { entityType: input.entityType, entityId: input.entityId, sourceId: input.sourceId },
  });
  if (existingLink) {
    throw new Error(`This Source is already attached to this ${input.entityType.toLowerCase()}.`);
  }

  const link = await prisma.entitySource.create({
    data: { entityType: input.entityType, entityId: input.entityId, sourceId: input.sourceId },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "SOURCE_ATTACHED",
    entityType: input.entityType,
    entityId: input.entityId,
    afterSnapshot: { sourceId: input.sourceId },
  });

  return link;
}

export async function detachSourceFromEntity(
  entityType: string,
  entityId: string,
  sourceId: string,
  actorId: string
): Promise<void> {
  const existing = await prisma.entitySource.findFirst({ where: { entityType, entityId, sourceId } });
  if (!existing) {
    throw new Error(`No Source attachment found for ${entityType} ${entityId} / Source ${sourceId}.`);
  }

  await prisma.entitySource.delete({ where: { id: existing.id } });

  await writeAuditLog({
    actorId,
    action: "SOURCE_DETACHED",
    entityType,
    entityId,
    beforeSnapshot: { sourceId },
  });
}
