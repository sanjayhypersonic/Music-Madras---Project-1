import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { DuplicateEntityError, findExactNormalizedDuplicate } from "../../mmke/duplicate-detection/detectDuplicateName";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import type { Composer, MusicalWork } from "@prisma/client";

export interface CreateMusicalWorkInput {
  slug: string;
  title: string;
  /** The primary composer (position 1). */
  composerId: string;
  /** R-36: co-composers in stated order (positions 2, 3, …). Duplicates of the primary are ignored. */
  coComposerIds?: string[];
  alternateTitles?: string[];
  language?: string;
  notes?: string;
  catalogueNumber?: string;
  keySignature?: string;
  actorId: string;
}

/**
 * A duplicate check scoped to the same composer, not the whole catalogue —
 * two different composers may legitimately share a work title (e.g. many
 * composers wrote a "Magnificat"), but the same composer having the same
 * work title twice is almost certainly a duplicate entry.
 */
export async function createMusicalWork(input: CreateMusicalWorkInput): Promise<MusicalWork> {
  const composer = await prisma.composer.findUnique({ where: { id: input.composerId } });
  if (!composer) {
    // Brief §13/§14: only a canonical Composer id is ever accepted here —
    // never free text — so a missing id means the caller (a form) sent a
    // stale or tampered value, not a name to create.
    throw new Error(`Composer ${input.composerId} does not exist.`);
  }

  const existing = await prisma.musicalWork.findMany({
    where: { composerId: input.composerId, archivedAt: null },
    select: { title: true },
  });

  const duplicate = findExactNormalizedDuplicate(
    input.title,
    existing.map((w) => w.title)
  );
  if (duplicate) {
    throw new DuplicateEntityError("MusicalWork", duplicate);
  }

  const composerIds = [...new Set([input.composerId, ...(input.coComposerIds ?? [])])];
  if (composerIds.length > 1) {
    const found = await prisma.composer.count({ where: { id: { in: composerIds } } });
    if (found !== composerIds.length) throw new Error("A co-composer does not exist.");
  }

  let work: MusicalWork;
  try {
    // R-36: the work and its composer rows (position 1 = the primary composer) are written together.
    work = await prisma.$transaction(async (tx) => {
      const created = await tx.musicalWork.create({
        data: {
          slug: input.slug,
          title: input.title,
          composerId: input.composerId,
          alternateTitles: input.alternateTitles ?? [],
          language: input.language,
          notes: input.notes,
          catalogueNumber: input.catalogueNumber,
          keySignature: input.keySignature,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
      });
      await tx.musicalWorkComposer.createMany({ data: composerIds.map((composerId, i) => ({ workId: created.id, composerId, position: i + 1 })) });
      return created;
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err, "slug")) {
      throw new SlugConflictError(input.slug);
    }
    throw err;
  }

  await writeAuditLog({
    actorId: input.actorId,
    action: "MUSICAL_WORK_CREATED",
    entityType: "MusicalWork",
    entityId: work.id,
    afterSnapshot: { ...work, composerIds },
  });

  return work;
}

export function findMusicalWorkById(id: string): Promise<MusicalWork | null> {
  return prisma.musicalWork.findUnique({ where: { id } });
}

export function findMusicalWorkBySlug(slug: string): Promise<MusicalWork | null> {
  return prisma.musicalWork.findUnique({ where: { slug } });
}

export interface MusicalWorkWithComposer extends MusicalWork {
  composer: Composer;
}

/** Studio detail-page lookup (Phase 6G-4C) — the work plus its canonical Composer, joined once. */
export function findMusicalWorkByIdWithComposer(id: string): Promise<MusicalWorkWithComposer | null> {
  return prisma.musicalWork.findUnique({ where: { id }, include: { composer: true } });
}

/**
 * The richer Studio detail-page lookup (Phase 6G-4C, brief §18): the Work
 * with its Composer, plus the canonical relationships a future Programme/
 * Recording page would traverse — proving the existing relationship
 * layer already resolves Work -> Programme and Work -> Recording without
 * any page-specific query.
 */
export function findMusicalWorkDetailForStudio(id: string) {
  return prisma.musicalWork.findUnique({
    where: { id },
    include: {
      composer: true,
      composerCredits: { include: { composer: true }, orderBy: { position: "asc" } },
      programmeItems: { include: { programme: true }, orderBy: { order: "asc" } },
      recordingRevisionLinks: { include: { revision: { include: { recording: true } } } },
    },
  });
}

/** Active works this composer composed OR co-composed (R-36), by title. */
export function listMusicalWorksByComposer(composerId: string): Promise<MusicalWork[]> {
  return prisma.musicalWork.findMany({
    where: { OR: [{ composerId }, { composerCredits: { some: { composerId } } }], archivedAt: null },
    orderBy: { title: "asc" },
  });
}

export interface MusicalWorkForStudio extends MusicalWorkWithComposer {
  _count: { programmeItems: number; recordingRevisionLinks: number };
}

/**
 * Studio-facing list (Phase 6G-4C, brief §15): every Work regardless of
 * archived state, with its Composer joined and cheap direct-relation
 * counts (single aggregated query, not one per row). An optional
 * case-insensitive title search.
 */
export function listMusicalWorksForStudio(searchQuery?: string): Promise<MusicalWorkForStudio[]> {
  return prisma.musicalWork.findMany({
    where: searchQuery ? { title: { contains: searchQuery, mode: "insensitive" } } : undefined,
    include: { composer: true, _count: { select: { programmeItems: true, recordingRevisionLinks: true } } },
    orderBy: { title: "asc" },
  });
}

export interface UpdateMusicalWorkInput {
  title?: string;
  alternateTitles?: string[];
  language?: string | null;
  notes?: string | null;
  catalogueNumber?: string | null;
  keySignature?: string | null;
  actorId: string;
}

/**
 * Edits the Work's own fields (brief §16) — deliberately never accepts
 * `slug` (kept immutable, mirroring updateComposer) or `composerId` (that
 * relationship change goes through changeMusicalWorkComposer below, so it
 * gets its own distinct audit action per brief §21).
 */
export async function updateMusicalWork(id: string, input: UpdateMusicalWorkInput): Promise<MusicalWork> {
  const before = await prisma.musicalWork.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`MusicalWork ${id} does not exist.`);
  }

  const updated = await prisma.musicalWork.update({
    where: { id },
    data: {
      title: input.title,
      alternateTitles: input.alternateTitles,
      language: input.language,
      notes: input.notes,
      catalogueNumber: input.catalogueNumber,
      keySignature: input.keySignature,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "MUSICAL_WORK_UPDATED",
    entityType: "MusicalWork",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Reassigns a Work's canonical Composer (brief §14/§18/§21) — always a
 * real Composer id from the picker, never free text creating a new
 * Composer. Audited separately from updateMusicalWork so "Composer
 * relationship changed for a Work" is its own visible audit action, not
 * folded into a generic field edit.
 */
export async function changeMusicalWorkComposer(id: string, newComposerId: string, actorId: string): Promise<MusicalWork> {
  const before = await prisma.musicalWork.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`MusicalWork ${id} does not exist.`);
  }

  const composer = await prisma.composer.findUnique({ where: { id: newComposerId } });
  if (!composer) {
    throw new Error(`Composer ${newComposerId} does not exist.`);
  }

  // R-36: the new primary takes position 1; the other co-composers keep their order behind it.
  const order = [newComposerId, ...(await listMusicalWorkComposerIds(id)).filter((c) => c !== before.composerId && c !== newComposerId)];
  const updated = await prisma.$transaction(async (tx) => {
    const work = await tx.musicalWork.update({ where: { id }, data: { composerId: newComposerId, updatedById: actorId } });
    await tx.musicalWorkComposer.deleteMany({ where: { workId: id } });
    await tx.musicalWorkComposer.createMany({ data: order.map((composerId, i) => ({ workId: id, composerId, position: i + 1 })) });
    return work;
  });

  await writeAuditLog({
    actorId,
    action: "MUSICAL_WORK_COMPOSER_CHANGED",
    entityType: "MusicalWork",
    entityId: id,
    beforeSnapshot: { composerId: before.composerId },
    afterSnapshot: { composerId: newComposerId },
  });

  return updated;
}

export async function archiveMusicalWork(id: string, actorId: string): Promise<MusicalWork> {
  const work = await prisma.musicalWork.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "MUSICAL_WORK_ARCHIVED",
    entityType: "MusicalWork",
    entityId: id,
  });

  return work;
}

export async function restoreMusicalWork(id: string, actorId: string): Promise<MusicalWork> {
  const work = await prisma.musicalWork.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "MUSICAL_WORK_RESTORED",
    entityType: "MusicalWork",
    entityId: id,
  });

  return work;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// R-36: co-composers. musical_work_composers holds every composer of a work in stated order; position 1 is always MusicalWork.composerId.

/** The work's composer ids in stated order (position 1 first). A work with no rows (created before the backfill) reads as its primary alone. */
export async function listMusicalWorkComposerIds(workId: string): Promise<string[]> {
  const [work, rows] = await Promise.all([
    prisma.musicalWork.findUnique({ where: { id: workId }, select: { composerId: true } }),
    prisma.musicalWorkComposer.findMany({ where: { workId }, orderBy: { position: "asc" }, select: { composerId: true } }),
  ]);
  if (!work) return [];
  const ids = rows.map((r) => r.composerId);
  return ids.length > 0 && ids[0] === work.composerId ? ids : [work.composerId, ...ids.filter((c) => c !== work.composerId)];
}

/**
 * Replaces a work's composers with `composerIds` in that order (Studio: add, remove, reorder). The first becomes the primary composer
 * (MusicalWork.composerId), so every reader that knows only one composer stays right. Refuses an empty list, an unknown composer, or a new primary
 * who already has another active work with this title (the same rule as changing the composer). Audited as MUSICAL_WORK_COMPOSERS_SET.
 */
export async function setMusicalWorkComposers(workId: string, composerIds: readonly string[], actorId: string): Promise<void> {
  const order = [...new Set(composerIds.filter(Boolean))];
  if (order.length === 0) throw new Error("A work needs at least one composer.");
  const before = await prisma.musicalWork.findUnique({ where: { id: workId } });
  if (!before) throw new Error(`MusicalWork ${workId} does not exist.`);
  if ((await prisma.composer.count({ where: { id: { in: order } } })) !== order.length) throw new Error("A composer in the list does not exist.");
  if (order[0] !== before.composerId) {
    const clash = await prisma.musicalWork.findMany({ where: { composerId: order[0], archivedAt: null, id: { not: workId } }, select: { title: true } });
    const duplicate = findExactNormalizedDuplicate(before.title, clash.map((w) => w.title));
    if (duplicate) throw new DuplicateEntityError("MusicalWork", duplicate);
  }
  const previous = await listMusicalWorkComposerIds(workId);
  await prisma.$transaction(async (tx) => {
    if (order[0] !== before.composerId) await tx.musicalWork.update({ where: { id: workId }, data: { composerId: order[0], updatedById: actorId } });
    else await tx.musicalWork.update({ where: { id: workId }, data: { updatedById: actorId } });
    await tx.musicalWorkComposer.deleteMany({ where: { workId } });
    await tx.musicalWorkComposer.createMany({ data: order.map((composerId, i) => ({ workId, composerId, position: i + 1 })) });
  });
  await writeAuditLog({ actorId, action: "MUSICAL_WORK_COMPOSERS_SET", entityType: "MusicalWork", entityId: workId, beforeSnapshot: { composerIds: previous }, afterSnapshot: { composerIds: order } });
}
