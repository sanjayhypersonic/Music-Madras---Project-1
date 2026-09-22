import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { computeNextOrder } from "../../mmke/programme/reorderProgrammeItems";
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

export async function createCollection(input: CreateCollectionInput): Promise<Collection> {
  const collection = await prisma.collection.create({
    data: {
      slug: input.slug,
      title: input.title,
      description: input.description,
      backingPlaylistId: input.backingPlaylistId,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

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
