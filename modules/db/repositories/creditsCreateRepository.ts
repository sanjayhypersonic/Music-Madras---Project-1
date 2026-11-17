import { prisma } from "../client";

// The database reads of the CREDITS CREATE tool (modules/jobs/videoCreditsCreateExecute.ts) that no other repository offers. Every WRITE that tool makes
// goes through the existing repositories and lifecycle services (composer, work, choir, conductor, artist, venue, programme, performance, recording
// intake, revision editing and the participant copy-on-write); this file only reads.

export interface CreditsDraftState {
  recordingId: string;
  status: string;
  revisionId: string | null;
  revisionUpdatedAt: Date | null;
  /** Who last changed the open draft: anyone but the import actor means an editor has worked on it, and the tool leaves it alone. */
  revisionUpdatedById: string | null;
  title: string | null;
  performanceId: string | null;
  workIds: string[];
}

export async function getCreditsDraftState(recordingId: string): Promise<CreditsDraftState | null> {
  const recording = await prisma.recording.findUnique({
    where: { id: recordingId },
    select: {
      id: true,
      status: true,
      currentDraftRevision: { select: { id: true, updatedAt: true, updatedById: true, title: true, performanceId: true, works: { select: { musicalWorkId: true }, orderBy: { order: "asc" } } } },
    },
  });
  if (!recording) return null;
  const draft = recording.currentDraftRevision;
  return {
    recordingId: recording.id,
    status: recording.status,
    revisionId: draft?.id ?? null,
    revisionUpdatedAt: draft?.updatedAt ?? null,
    revisionUpdatedById: draft?.updatedById ?? null,
    title: draft?.title ?? null,
    performanceId: draft?.performanceId ?? null,
    workIds: draft?.works.map((w) => w.musicalWorkId) ?? [],
  };
}

/**
 * A Programme this tool created earlier for the same Recording title and works, left without a Performance by an interrupted run: reused instead
 * of creating a second one. Programme titles legitimately repeat, so only the import actor's own, unused, identical programmes qualify.
 */
export async function findReusableImportProgramme(title: string, actorId: string, workIds: readonly string[]): Promise<{ id: string } | null> {
  const candidates = await prisma.programme.findMany({
    where: { title, createdById: actorId, archivedAt: null, performances: { none: {} } },
    select: { id: true, items: { select: { musicalWorkId: true }, orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  const wanted = workIds.join("\u0000");
  return candidates.find((p) => p.items.map((i) => i.musicalWorkId).join("\u0000") === wanted) ?? null;
}

export type SluggedEntity = "composer" | "musicalWork" | "choir" | "conductor" | "artist" | "venue" | "programme";

/** Whether a slug is already used by any row (archived ones included) of the entity. */
export async function isSlugTaken(entity: SluggedEntity, slug: string): Promise<boolean> {
  const where = { where: { slug }, select: { id: true } } as const;
  switch (entity) {
    case "composer":
      return (await prisma.composer.findUnique(where)) !== null;
    case "musicalWork":
      return (await prisma.musicalWork.findUnique(where)) !== null;
    case "choir":
      return (await prisma.choir.findUnique(where)) !== null;
    case "conductor":
      return (await prisma.conductor.findUnique(where)) !== null;
    case "artist":
      return (await prisma.artist.findUnique(where)) !== null;
    case "venue":
      return (await prisma.venue.findUnique(where)) !== null;
    case "programme":
      return (await prisma.programme.findUnique(where)) !== null;
  }
}
