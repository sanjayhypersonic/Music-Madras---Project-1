import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { computeNextOrder, reorderProgrammeItems } from "../../mmke/programme/reorderProgrammeItems";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { Collection } from "@prisma/client";

// Collections (brief §8): database-driven curated groupings. No hardcoded
// collections exist anywhere in application code — every Collection row
// here is created through this repository (and, in a later phase, Studio
// screens calling it), never as a TypeScript constant.

export interface CreateCollectionInput {
  slug: string;
  title: string;
  description?: string;
  backingPlaylistId?: string;
  actorId: string;
}

/**
 * Phase 6G-4I: catches the slug @unique collision the same way
 * createComposer/createVenue/createProgramme already do — this was
 * previously unguarded (a raw P2002 would have reached the caller as an
 * unhandled 500).
 */
export async function createCollection(input: CreateCollectionInput): Promise<Collection> {
  let collection: Collection;
  try {
    collection = await prisma.collection.create({
      data: {
        slug: input.slug,
        title: input.title,
        description: input.description,
        backingPlaylistId: input.backingPlaylistId,
        createdById: input.actorId,
        updatedById: input.actorId,
      },
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(input.slug);
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: "COLLECTION_CREATED",
    entityType: "Collection",
    entityId: collection.id,
    afterSnapshot: collection,
  });

  return collection;
}

export async function addRecordingToCollection(
  collectionId: string,
  recordingId: string,
  actorId: string
) {
  const existingItems = await prisma.collectionRecording.findMany({
    where: { collectionId },
    select: { order: true },
  });

  const link = await prisma.collectionRecording.upsert({
    where: { collectionId_recordingId: { collectionId, recordingId } },
    create: { collectionId, recordingId, order: computeNextOrder(existingItems.map((i, index) => ({ id: String(index), order: i.order }))) },
    update: {},
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_ADDED_TO_COLLECTION",
    entityType: "Collection",
    entityId: collectionId,
    afterSnapshot: { recordingId },
  });

  return link;
}

export async function removeRecordingFromCollection(
  collectionId: string,
  recordingId: string,
  actorId: string
): Promise<void> {
  await prisma.collectionRecording.delete({
    where: { collectionId_recordingId: { collectionId, recordingId } },
  });

  await writeAuditLog({
    actorId,
    action: "RECORDING_REMOVED_FROM_COLLECTION",
    entityType: "Collection",
    entityId: collectionId,
    beforeSnapshot: { recordingId },
  });
}

/**
 * Phase 6G-4I: reorders the Recordings within a Collection's running
 * order — same pure `reorderProgrammeItems` renumbering logic Programme
 * already uses, keyed here by `recordingId` rather than a synthetic
 * ProgrammeItem id, since CollectionRecording has no id column of its
 * own (its primary key is the composite [collectionId, recordingId]).
 * Its own distinct audit action, separate from `RECORDING_ADDED/REMOVED_
 * TO/FROM_COLLECTION` and from a plain Collection field edit.
 */
export async function reorderCollectionRecordings(
  collectionId: string,
  movedRecordingId: string,
  targetIndex: number,
  actorId: string
) {
  return prisma.$transaction(async (tx) => {
    const links = await tx.collectionRecording.findMany({ where: { collectionId }, orderBy: { order: "asc" } });
    const reordered = reorderProgrammeItems(
      links.map((link) => ({ id: link.recordingId, order: link.order })),
      movedRecordingId,
      targetIndex
    );

    await Promise.all(
      reordered.map((item) =>
        tx.collectionRecording.update({
          where: { collectionId_recordingId: { collectionId, recordingId: item.id } },
          data: { order: item.order },
        })
      )
    );

    await writeAuditLog(
      {
        actorId,
        action: "COLLECTION_RECORDINGS_REORDERED",
        entityType: "Collection",
        entityId: collectionId,
        afterSnapshot: { order: reordered.map((item) => ({ recordingId: item.id, order: item.order })) },
      },
      tx
    );

    return tx.collectionRecording.findMany({ where: { collectionId }, orderBy: { order: "asc" } });
  });
}

/**
 * Phase 6G-4I: the CollectionWork sibling of addRecordingToCollection —
 * same upsert-as-no-op duplicate handling (brief: "adding the same
 * Recording twice should produce a safe validation error or no-op
 * according to the existing repository conventions").
 */
export async function addMusicalWorkToCollection(collectionId: string, musicalWorkId: string, actorId: string) {
  const existingItems = await prisma.collectionWork.findMany({
    where: { collectionId },
    select: { order: true },
  });

  const link = await prisma.collectionWork.upsert({
    where: { collectionId_musicalWorkId: { collectionId, musicalWorkId } },
    create: { collectionId, musicalWorkId, order: computeNextOrder(existingItems.map((i, index) => ({ id: String(index), order: i.order }))) },
    update: {},
  });

  await writeAuditLog({
    actorId,
    action: "WORK_ADDED_TO_COLLECTION",
    entityType: "Collection",
    entityId: collectionId,
    afterSnapshot: { musicalWorkId },
  });

  return link;
}

export async function removeMusicalWorkFromCollection(
  collectionId: string,
  musicalWorkId: string,
  actorId: string
): Promise<void> {
  await prisma.collectionWork.delete({
    where: { collectionId_musicalWorkId: { collectionId, musicalWorkId } },
  });

  await writeAuditLog({
    actorId,
    action: "WORK_REMOVED_FROM_COLLECTION",
    entityType: "Collection",
    entityId: collectionId,
    beforeSnapshot: { musicalWorkId },
  });
}

/** The CollectionWork sibling of reorderCollectionRecordings above. */
export async function reorderCollectionWorks(
  collectionId: string,
  movedMusicalWorkId: string,
  targetIndex: number,
  actorId: string
) {
  return prisma.$transaction(async (tx) => {
    const links = await tx.collectionWork.findMany({ where: { collectionId }, orderBy: { order: "asc" } });
    const reordered = reorderProgrammeItems(
      links.map((link) => ({ id: link.musicalWorkId, order: link.order })),
      movedMusicalWorkId,
      targetIndex
    );

    await Promise.all(
      reordered.map((item) =>
        tx.collectionWork.update({
          where: { collectionId_musicalWorkId: { collectionId, musicalWorkId: item.id } },
          data: { order: item.order },
        })
      )
    );

    await writeAuditLog(
      {
        actorId,
        action: "COLLECTION_WORKS_REORDERED",
        entityType: "Collection",
        entityId: collectionId,
        afterSnapshot: { order: reordered.map((item) => ({ musicalWorkId: item.id, order: item.order })) },
      },
      tx
    );

    return tx.collectionWork.findMany({ where: { collectionId }, orderBy: { order: "asc" } });
  });
}

export async function publishCollection(collectionId: string, actorId: string): Promise<Collection> {
  const collection = await prisma.collection.update({
    where: { id: collectionId },
    data: { status: "PUBLISHED", updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "COLLECTION_PUBLISHED",
    entityType: "Collection",
    entityId: collectionId,
  });

  return collection;
}

/**
 * Phase 6G-4I: reverts a Collection from PUBLISHED back to DRAFT — its
 * own explicit audit event, never folded into a generic status update
 * (brief §9: "do not silently change status through a generic update
 * action").
 */
export async function unpublishCollection(collectionId: string, actorId: string): Promise<Collection> {
  const collection = await prisma.collection.update({
    where: { id: collectionId },
    data: { status: "DRAFT", updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "COLLECTION_UNPUBLISHED",
    entityType: "Collection",
    entityId: collectionId,
  });

  return collection;
}

export async function archiveCollection(collectionId: string, actorId: string): Promise<Collection> {
  const collection = await prisma.collection.update({
    where: { id: collectionId },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "COLLECTION_ARCHIVED",
    entityType: "Collection",
    entityId: collectionId,
  });

  return collection;
}

/**
 * Restoring reuses the existing archivedAt convention (brief §10) —
 * never deletes the row, never touches CollectionRecording/CollectionWork
 * memberships (they were never cascaded away by archiving in the first
 * place).
 */
export async function restoreCollection(collectionId: string, actorId: string): Promise<Collection> {
  const collection = await prisma.collection.update({
    where: { id: collectionId },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "COLLECTION_RESTORED",
    entityType: "Collection",
    entityId: collectionId,
  });

  return collection;
}

export function findCollectionBySlug(slug: string) {
  return prisma.collection.findUnique({
    where: { slug },
    include: {
      recordingLinks: { include: { recording: true }, orderBy: { order: "asc" } },
      workLinks: { include: { musicalWork: true }, orderBy: { order: "asc" } },
    },
  });
}

export function listPublishedCollections(): Promise<Collection[]> {
  return prisma.collection.findMany({
    where: { status: "PUBLISHED", archivedAt: null },
    orderBy: { title: "asc" },
  });
}

/**
 * The scoped-by-id sibling of listPublishedCollections (Phase 6G-4A,
 * entity relationship/media-aggregation layer). Given a specific set of
 * Collection ids reached through a canonical MMKE relationship (e.g.
 * Recording -> CollectionRecording), returns only the ones that are
 * genuinely public right now. Distinct from — never derived from — the
 * raw YouTube playlists a Collection may optionally back onto (brief §9):
 * a playlist containing the underlying video does not make a Collection
 * exist or make it public.
 */
export function findPublicCollectionsByIds(ids: string[]): Promise<Collection[]> {
  if (ids.length === 0) return Promise.resolve([]);

  return prisma.collection.findMany({
    where: { id: { in: ids }, status: "PUBLISHED", archivedAt: null },
    orderBy: { title: "asc" },
  });
}

/** Studio-facing list (Phase 4): drafts too, not just what the Museum shows. */
export function listCollections(): Promise<Collection[]> {
  return prisma.collection.findMany({
    where: { archivedAt: null },
    orderBy: { title: "asc" },
  });
}

/**
 * Phase 6G-4I: the Studio detail-page counterpart of findCollectionBySlug
 * — same shape, looked up by id instead, and additionally including each
 * linked Recording's revisions (so a title can be displayed) since the
 * Studio detail page needs more than the public read path does. Left as
 * its own function rather than widening findCollectionBySlug's include,
 * per the instruction to preserve that function's existing behavior for
 * its public-read callers.
 */
export function findCollectionById(id: string) {
  return prisma.collection.findUnique({
    where: { id },
    include: {
      recordingLinks: {
        include: { recording: { include: { currentDraftRevision: true, currentPublishedRevision: true } } },
        orderBy: { order: "asc" },
      },
      workLinks: { include: { musicalWork: true }, orderBy: { order: "asc" } },
    },
  });
}

export interface CollectionForStudio extends Collection {
  _count: { recordingLinks: number; workLinks: number };
}

/**
 * Studio-facing list (Phase 6G-4I, mirrors listProgrammesForStudio/
 * listPerformancesForStudio): every Collection regardless of archived
 * state, with cheap direct-relation counts for both membership types,
 * and an optional case-insensitive title search. Distinct from the
 * pre-existing listCollections() above (Phase 4, active-only, no counts,
 * no search) — that function has its own callers elsewhere and is left
 * untouched.
 */
export function listCollectionsForStudio(searchQuery?: string): Promise<CollectionForStudio[]> {
  return prisma.collection.findMany({
    where: searchQuery ? { title: { contains: searchQuery, mode: "insensitive" } } : undefined,
    include: { _count: { select: { recordingLinks: true, workLinks: true } } },
    orderBy: { title: "asc" },
  });
}

export interface UpdateCollectionInput {
  title?: string;
  description?: string | null;
  actorId: string;
}

/**
 * Edits the Collection's own fields (title/description) — mirrors
 * updateProgramme/updateVenue: never accepts `slug` (kept immutable) or
 * `status`/`archivedAt` (those relationship-shaped changes go through
 * publishCollection/unpublishCollection/archiveCollection/
 * restoreCollection above, each with its own distinct audit event).
 */
export async function updateCollection(id: string, input: UpdateCollectionInput): Promise<Collection> {
  const before = await prisma.collection.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Collection ${id} does not exist.`);
  }

  const updated = await prisma.collection.update({
    where: { id },
    data: {
      title: input.title,
      description: input.description,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "COLLECTION_UPDATED",
    entityType: "Collection",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}
