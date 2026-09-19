import { prisma } from "../client";
import { writeAuditLog } from "../../audit/writeAuditLog";
import { computeNextOrder, reorderProgrammeItems } from "../../mmke/programme/reorderProgrammeItems";
import type { Programme, ProgrammeItem } from "@prisma/client";

// Programme as a first-class entity (brief §4): a real Programme with real,
// ordered ProgrammeItem rows, each pointing at a canonical MusicalWork —
// never one large text field.

export interface CreateProgrammeInput {
  slug: string;
  title: string;
  notes?: string;
  actorId: string;
}

export async function createProgramme(input: CreateProgrammeInput): Promise<Programme> {
  const programme = await prisma.programme.create({
    data: {
      slug: input.slug,
      title: input.title,
      notes: input.notes,
      createdById: input.actorId,
      updatedById: input.actorId,
    },
  });

  await writeAuditLog({
    actorId: input.actorId,
    action: "PROGRAMME_CREATED",
    entityType: "Programme",
    entityId: programme.id,
    afterSnapshot: programme,
  });

  return programme;
}

export interface AddProgrammeItemInput {
  programmeId: string;
  musicalWorkId: string;
  movement?: string;
  isEncore?: boolean;
  actorId: string;
}

/**
 * Appends a work to the end of a programme's running order. Order is
 * computed from the existing items (modules/mmke/programme, pure), not
 * left to the caller to guess.
 */
export async function addProgrammeItem(input: AddProgrammeItemInput): Promise<ProgrammeItem> {
  return prisma.$transaction(async (tx) => {
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
  });
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

export async function removeProgrammeItem(itemId: string, actorId: string): Promise<void> {
  const item = await prisma.programmeItem.delete({ where: { id: itemId } });

  await writeAuditLog({
    actorId,
    action: "PROGRAMME_ITEM_REMOVED",
    entityType: "Programme",
    entityId: item.programmeId,
    beforeSnapshot: item,
  });
}

export function findProgrammeById(id: string) {
  return prisma.programme.findUnique({
    where: { id },
    include: { items: { include: { musicalWork: true }, orderBy: { order: "asc" } } },
  });
}
