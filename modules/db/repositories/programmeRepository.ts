import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { computeNextOrder, reorderProgrammeItems } from "../../mmke/programme/reorderProgrammeItems";
import { SlugConflictError } from "../../mmke/slug/SlugConflictError";
import { isUniqueConstraintViolation } from "../isUniqueConstraintViolation";
import { isLockTimeoutError } from "../isLockTimeoutError";
import { PUBLISHED_REVISION_WHERE } from "./publicEligibility";
import type { Prisma, Programme, ProgrammeItem } from "@prisma/client";

// Programme as a first-class entity (brief §4): a real Programme with real,
// ordered ProgrammeItem rows, each pointing at a canonical MusicalWork —
// never one large text field.

export interface CreateProgrammeInput {
  slug: string;
  title: string;
  notes?: string;
  actorId: string;
}

/**
 * Phase 6G-4G: catches the slug @unique collision the same way
 * createComposer/createVenue/createMusicalWork already do — this was
 * previously unguarded (a raw P2002 would have reached the caller as an
 * unhandled 500). No duplicate-*title* check is added here, deliberately
 * — unlike a Composer/Choir/Venue name, a Programme title legitimately
 * repeats (e.g. an annual "Christmas Concert" run across many years), so
 * the exact-normalized-name guard the other simple entities use would be
 * a false-positive machine here, not a safety net.
 */
export async function createProgramme(input: CreateProgrammeInput): Promise<Programme> {
  let programme: Programme;
  try {
    programme = await prisma.programme.create({
      data: {
        slug: input.slug,
        title: input.title,
        notes: input.notes,
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
    action: "PROGRAMME_CREATED",
    entityType: "Programme",
    entityId: programme.id,
    afterSnapshot: programme,
  });

  return programme;
}

/**
 * Phase 6J-10F — a Programme is a shared catalogue record: its running order is shown on its own public page and on every
 * Performance page that uses it. The Recording workflow's Programme step is part of preparing a DRAFT, so it must not
 * change a Programme that published content already shows. Catalogue editing (Studio > Catalogue) is the explicit,
 * deliberate way to change a shared programme and does not use this guard.
 */
export class ProgrammeInPublishedContentError extends Error {
  constructor() {
    super(
      "This programme is part of published content, so changing its running order here would change a live page. " +
        "Create a new programme for this recording, or edit this one deliberately from the Catalogue."
    );
    this.name = "ProgrammeInPublishedContentError";
  }
}

type ProgrammeDbClient = Prisma.TransactionClient | typeof prisma;

export class ProgrammeBusyError extends Error {
  constructor() {
    super("This programme is being changed or published by someone else right now. Nothing was changed. Try again in a moment.");
    this.name = "ProgrammeBusyError";
  }
}

export const PROGRAMME_EDIT_LOCK_TIMEOUT_MS = 5000;

/** Advisory-lock key (hashtext of this string) serializing the Recording workflow's Programme edits against publications that use the Programme. */
export function programmeEditLockKey(programmeId: string): string {
  return `programme-edit:${programmeId}`;
}

/**
 * Phase 6J-10F — takes the per-Programme edit lock for the rest of the transaction. Held by (a) the Recording workflow's
 * guarded Programme edits for their whole check-then-write, and (b) publishRecordingDraft for the draft Performance's
 * Programme until the publication commits. That closes the window in which a Programme could become published content
 * between the edit's guard check and its write. Lock order: after the Recording lock and the draft row, before any
 * Performance row; edits take no other lock, so there is no cycle.
 */
export async function lockProgrammeAgainstWorkflowEdits(tx: Prisma.TransactionClient, programmeId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${programmeEditLockKey(programmeId)}))`;
}

/** Runs a guarded Programme edit under the Programme lock (bounded wait). Throws ProgrammeBusyError when the lock is not available in time. */
async function withProgrammeEditLock<T>(programmeId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('lock_timeout', ${`${PROGRAMME_EDIT_LOCK_TIMEOUT_MS}ms`}, true)`;
      await lockProgrammeAgainstWorkflowEdits(tx, programmeId);
      return fn(tx);
    });
  } catch (err) {
    if (isLockTimeoutError(err)) throw new ProgrammeBusyError();
    throw err;
  }
}

/** True when any Performance using the Programme is used by some Recording's current published revision. */
export async function isProgrammeInPublishedContent(programmeId: string, client: ProgrammeDbClient = prisma): Promise<boolean> {
  return (await client.performance.count({ where: { programmeId, revisions: { some: PUBLISHED_REVISION_WHERE } } })) > 0;
}

export interface AddProgrammeItemInput {
  programmeId: string;
  musicalWorkId: string;
  movement?: string;
  isEncore?: boolean;
  actorId: string;
  /** Recording workflow only (6J-10F): refuse, in the same transaction as the write, when published content shows this Programme. */
  refuseIfInPublishedContent?: boolean;
}

/**
 * Appends a work to the end of a programme's running order. Order is
 * computed from the existing items (modules/mmke/programme, pure), not
 * left to the caller to guess.
 */
export async function addProgrammeItem(input: AddProgrammeItemInput): Promise<ProgrammeItem> {
  const run = async (tx: Prisma.TransactionClient): Promise<ProgrammeItem> => {
    if (input.refuseIfInPublishedContent && (await isProgrammeInPublishedContent(input.programmeId, tx))) throw new ProgrammeInPublishedContentError();
    const existingItems = await tx.programmeItem.findMany({
      where: { programmeId: input.programmeId },
      select: { id: true, order: true },
    });

    const nextOrder = computeNextOrder(existingItems);

    const item = await tx.programmeItem.create({
      data: {
        programmeId: input.programmeId,
        musicalWorkId: input.musicalWorkId,
        order: nextOrder,
        movement: input.movement,
        isEncore: input.isEncore ?? false,
      },
    });

    await writeAuditLog(
      {
        actorId: input.actorId,
        action: "PROGRAMME_ITEM_ADDED",
        entityType: "Programme",
        entityId: input.programmeId,
        afterSnapshot: item,
      },
      tx
    );

    return item;
  };
  // The guarded (Recording workflow) path holds the Programme lock across its check and its write (6J-10F); the
  // catalogue path is a deliberate global edit and is unchanged.
  return input.refuseIfInPublishedContent ? withProgrammeEditLock(input.programmeId, run) : prisma.$transaction(run);
}

/**
 * Moves one item to a new position and renumbers the rest — the actual
 * reordering algorithm is the pure, tested function in
 * modules/mmke/programme; this is just the load/persist wrapper.
 */
export async function reorderProgrammeItem(
  programmeId: string,
  movedItemId: string,
  targetIndex: number,
  actorId: string
): Promise<ProgrammeItem[]> {
  return prisma.$transaction(async (tx) => {
    const items = await tx.programmeItem.findMany({
      where: { programmeId },
      orderBy: { order: "asc" },
    });

    const reordered = reorderProgrammeItems(items, movedItemId, targetIndex);

    // Two-phase update to avoid transiently colliding with the
    // (programmeId, order) unique constraint while renumbering.
    await Promise.all(
      reordered.map((item, index) =>
        tx.programmeItem.update({ where: { id: item.id }, data: { order: -(index + 1) } })
      )
    );
    await Promise.all(
      reordered.map((item) => tx.programmeItem.update({ where: { id: item.id }, data: { order: item.order } }))
    );

    await writeAuditLog(
      {
        actorId,
        action: "PROGRAMME_ITEMS_REORDERED",
        entityType: "Programme",
        entityId: programmeId,
        afterSnapshot: { order: reordered.map((item) => ({ id: item.id, order: item.order })) },
      },
      tx
    );

    return tx.programmeItem.findMany({ where: { programmeId }, orderBy: { order: "asc" } });
  });
}

export async function removeProgrammeItem(
  itemId: string,
  actorId: string,
  options: { refuseIfInPublishedContent?: boolean } = {}
): Promise<void> {
  const run = async (tx: Prisma.TransactionClient): Promise<void> => {
    if (options.refuseIfInPublishedContent) {
      const existing = await tx.programmeItem.findUnique({ where: { id: itemId }, select: { programmeId: true } });
      if (existing && (await isProgrammeInPublishedContent(existing.programmeId, tx))) throw new ProgrammeInPublishedContentError();
    }
    const item = await tx.programmeItem.delete({ where: { id: itemId } });

    await writeAuditLog(
      {
        actorId,
        action: "PROGRAMME_ITEM_REMOVED",
        entityType: "Programme",
        entityId: item.programmeId,
        beforeSnapshot: item,
      },
      tx
    );
  };
  if (!options.refuseIfInPublishedContent) {
    await prisma.$transaction(run);
    return;
  }
  // The item's Programme is looked up first (it never changes), then the whole check-then-delete runs under that
  // Programme's lock, so it is serialized against a publication that would make the Programme live.
  const target = await prisma.programmeItem.findUnique({ where: { id: itemId }, select: { programmeId: true } });
  if (!target) {
    await prisma.$transaction(run); // surfaces the same "record not found" error as before
    return;
  }
  await withProgrammeEditLock(target.programmeId, run);
}

export function findProgrammeById(id: string) {
  return prisma.programme.findUnique({
    where: { id },
    include: { items: { include: { musicalWork: true }, orderBy: { order: "asc" } } },
  });
}

export function listProgrammes(): Promise<Programme[]> {
  return prisma.programme.findMany({
    where: { archivedAt: null },
    orderBy: { title: "asc" },
  });
}

export interface ProgrammeForStudio extends Programme {
  _count: { items: number };
}

/**
 * Studio-facing list (Phase 6G-4G, mirrors listComposersForStudio): every
 * Programme regardless of archived state, with a cheap direct-relation
 * item count, and an optional case-insensitive title search.
 */
export function listProgrammesForStudio(searchQuery?: string): Promise<ProgrammeForStudio[]> {
  return prisma.programme.findMany({
    where: searchQuery ? { title: { contains: searchQuery, mode: "insensitive" } } : undefined,
    include: { _count: { select: { items: true } } },
    orderBy: { title: "asc" },
  });
}

export interface UpdateProgrammeInput {
  title?: string;
  notes?: string | null;
  actorId: string;
}

/**
 * Edits the Programme's own fields (title/notes) — mirrors updateComposer/
 * updateVenue exactly: slug stays immutable, no duplicate-title re-check
 * on edit (same reasoning as createProgramme above).
 */
export async function updateProgramme(id: string, input: UpdateProgrammeInput): Promise<Programme> {
  const before = await prisma.programme.findUnique({ where: { id } });
  if (!before) {
    throw new Error(`Programme ${id} does not exist.`);
  }

  const updated = await prisma.programme.update({
    where: { id },
    data: {
      title: input.title,
      notes: input.notes,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "PROGRAMME_UPDATED",
    entityType: "Programme",
    entityId: id,
    beforeSnapshot: before,
    afterSnapshot: updated,
  });

  return updated;
}

/**
 * Archiving/restoring reuses the existing archivedAt convention — never
 * deletes the row, never cascades to ProgrammeItems or Performances.
 */
export async function archiveProgramme(id: string, actorId: string): Promise<Programme> {
  const programme = await prisma.programme.update({
    where: { id },
    data: { archivedAt: new Date(), updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "PROGRAMME_ARCHIVED",
    entityType: "Programme",
    entityId: id,
  });

  return programme;
}

export async function restoreProgramme(id: string, actorId: string): Promise<Programme> {
  const programme = await prisma.programme.update({
    where: { id },
    data: { archivedAt: null, updatedById: actorId },
  });

  await writeAuditLog({
    actorId,
    action: "PROGRAMME_RESTORED",
    entityType: "Programme",
    entityId: id,
  });

  return programme;
}
