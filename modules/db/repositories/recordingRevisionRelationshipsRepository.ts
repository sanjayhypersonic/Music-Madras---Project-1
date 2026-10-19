import { writeAuditLog } from "../../audit/writeAuditLog";
import { prisma } from "../client";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { withEditableDraftRevision } from "./recordingRepository";
import type { Prisma } from "@prisma/client";

// Phase 6J-11B — revision-scoped Recording relationships: a RecordingRevision's own Sources, RightsInformation and
// Occasions (tables recording_revision_sources / _rights / _occasions).
//
// THIS IS THE INERT FOUNDATION. Nothing in the public site, the Studio Relationships step or Content Intelligence calls
// these functions yet: they still read and write the legacy Recording-level EntitySource / EntityRights / EntityOccasion
// rows (entityType "RECORDING"), which this module never touches. There is deliberately NO dual write. The cutover
// (writers, readers, backfill) is a separate, separately approved phase; see docs/recording-publication-safety.md.
//
// Protocol: every write goes through withEditableDraftRevision — the per-Recording edit lock, then a check, inside the
// same transaction, that the revision is a DRAFT, is the Recording's current draft, and the Recording is not archived
// (RevisionNotEditableError otherwise; a published or superseded revision can never be changed). The link row and its
// audit entry (entityType "RecordingRevision", like the work/media child writes) commit or roll back together. A
// duplicate is rejected by the composite primary key (DuplicateRevisionRelationshipError), never by a pre-check alone.
// Authorization is NOT decided here: callers (Studio actions) own it. The shared Source / RightsInformation / Occasion
// rows are never copied or modified — only links to them.

export type RevisionRelationshipKind = "source" | "rights" | "occasion";

export class DuplicateRevisionRelationshipError extends Error {
  constructor(readonly kind: RevisionRelationshipKind) {
    super(`This ${kind === "rights" ? "rights record" : kind} is already attached to this draft.`);
    this.name = "DuplicateRevisionRelationshipError";
  }
}

export class RevisionRelationshipNotFoundError extends Error {
  constructor(readonly kind: RevisionRelationshipKind) {
    super(`This ${kind === "rights" ? "rights record" : kind} is not attached to this draft.`);
    this.name = "RevisionRelationshipNotFoundError";
  }
}

type DbClient = Prisma.TransactionClient | typeof prisma;

// ------------------------------------------------------------------ sources

export function listSourcesForRevision(revisionId: string, client: DbClient = prisma) {
  return client.recordingRevisionSource.findMany({ where: { revisionId }, include: { source: true }, orderBy: [{ createdAt: "asc" }, { sourceId: "asc" }] });
}

export async function attachSourceToRevision(revisionId: string, sourceId: string, actorId: string) {
  return withEditableDraftRevision(revisionId, async (tx) => {
    const source = await tx.source.findUnique({ where: { id: sourceId }, select: { id: true } });
    if (!source) throw new Error(`Source ${sourceId} does not exist.`);
    let link;
    try {
      link = await tx.recordingRevisionSource.create({ data: { revisionId, sourceId } });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new DuplicateRevisionRelationshipError("source");
      throw err;
    }
    await writeAuditLog({ actorId, action: "SOURCE_ATTACHED_TO_RECORDING_REVISION", entityType: "RecordingRevision", entityId: revisionId, afterSnapshot: { sourceId } }, tx);
    return link;
  });
}

export async function detachSourceFromRevision(revisionId: string, sourceId: string, actorId: string): Promise<void> {
  await withEditableDraftRevision(revisionId, async (tx) => {
    const existing = await tx.recordingRevisionSource.findUnique({ where: { revisionId_sourceId: { revisionId, sourceId } }, select: { sourceId: true } });
    if (!existing) throw new RevisionRelationshipNotFoundError("source");
    await tx.recordingRevisionSource.delete({ where: { revisionId_sourceId: { revisionId, sourceId } } });
    await writeAuditLog({ actorId, action: "SOURCE_DETACHED_FROM_RECORDING_REVISION", entityType: "RecordingRevision", entityId: revisionId, beforeSnapshot: { sourceId } }, tx);
  });
}

// ------------------------------------------------------------------- rights

export function listRightsForRevision(revisionId: string, client: DbClient = prisma) {
  return client.recordingRevisionRights.findMany({ where: { revisionId }, include: { rightsInformation: true }, orderBy: [{ createdAt: "asc" }, { rightsInformationId: "asc" }] });
}

export async function attachRightsToRevision(revisionId: string, rightsInformationId: string, actorId: string) {
  return withEditableDraftRevision(revisionId, async (tx) => {
    const rights = await tx.rightsInformation.findUnique({ where: { id: rightsInformationId }, select: { id: true } });
    if (!rights) throw new Error(`RightsInformation ${rightsInformationId} does not exist.`);
    let link;
    try {
      link = await tx.recordingRevisionRights.create({ data: { revisionId, rightsInformationId } });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new DuplicateRevisionRelationshipError("rights");
      throw err;
    }
    await writeAuditLog({ actorId, action: "RIGHTS_ATTACHED_TO_RECORDING_REVISION", entityType: "RecordingRevision", entityId: revisionId, afterSnapshot: { rightsInformationId } }, tx);
    return link;
  });
}

export async function detachRightsFromRevision(revisionId: string, rightsInformationId: string, actorId: string): Promise<void> {
  await withEditableDraftRevision(revisionId, async (tx) => {
    const existing = await tx.recordingRevisionRights.findUnique({ where: { revisionId_rightsInformationId: { revisionId, rightsInformationId } }, select: { rightsInformationId: true } });
    if (!existing) throw new RevisionRelationshipNotFoundError("rights");
    await tx.recordingRevisionRights.delete({ where: { revisionId_rightsInformationId: { revisionId, rightsInformationId } } });
    await writeAuditLog({ actorId, action: "RIGHTS_DETACHED_FROM_RECORDING_REVISION", entityType: "RecordingRevision", entityId: revisionId, beforeSnapshot: { rightsInformationId } }, tx);
  });
}

// ---------------------------------------------------------------- occasions

export function listOccasionsForRevision(revisionId: string, client: DbClient = prisma) {
  return client.recordingRevisionOccasion.findMany({ where: { revisionId }, include: { occasion: true }, orderBy: [{ createdAt: "asc" }, { occasionId: "asc" }] });
}

export async function attachOccasionToRevision(revisionId: string, occasionId: string, actorId: string) {
  return withEditableDraftRevision(revisionId, async (tx) => {
    const occasion = await tx.occasion.findUnique({ where: { id: occasionId } });
    if (!occasion) throw new Error(`Occasion ${occasionId} does not exist.`);
    // Same convention as the legacy attach (occasionRepository): an archived Occasion cannot be NEWLY attached.
    if (occasion.archivedAt) throw new Error(`Occasion "${occasion.name}" is archived and cannot be newly attached.`);
    let link;
    try {
      link = await tx.recordingRevisionOccasion.create({ data: { revisionId, occasionId } });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) throw new DuplicateRevisionRelationshipError("occasion");
      throw err;
    }
    await writeAuditLog(
      { actorId, action: "OCCASION_ATTACHED_TO_RECORDING_REVISION", entityType: "RecordingRevision", entityId: revisionId, afterSnapshot: { occasionId, occasionName: occasion.name } },
      tx
    );
    return link;
  });
}

export async function detachOccasionFromRevision(revisionId: string, occasionId: string, actorId: string): Promise<void> {
  await withEditableDraftRevision(revisionId, async (tx) => {
    const existing = await tx.recordingRevisionOccasion.findUnique({ where: { revisionId_occasionId: { revisionId, occasionId } }, include: { occasion: true } });
    if (!existing) throw new RevisionRelationshipNotFoundError("occasion");
    await tx.recordingRevisionOccasion.delete({ where: { revisionId_occasionId: { revisionId, occasionId } } });
    await writeAuditLog(
      { actorId, action: "OCCASION_DETACHED_FROM_RECORDING_REVISION", entityType: "RecordingRevision", entityId: revisionId, beforeSnapshot: { occasionId, occasionName: existing.occasion.name } },
      tx
    );
  });
}