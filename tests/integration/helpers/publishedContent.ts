import { randomUUID } from "crypto";
import { prisma } from "../../../modules/db/client";
import { createProgramme } from "../../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../../modules/db/repositories/performanceRepository";
import {
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../../modules/db/repositories/recordingRepository";

// Phase 6J-1 — public discovery is eligibility-based: a catalogue entity is
// public only while it is reachable from published archive content
// (modules/db/repositories/publicEligibility.ts). Tests that exercise how a
// public surface treats an entity (search, sitemap, entity pages) must
// therefore reach that entity through a published Recording, exactly as real
// content does. These helpers publish the smallest such Recording and clean
// up after themselves — rows that reference a Work are RESTRICT-deleted, so a
// caller must run `cleanup()` BEFORE deleting the Work/Composer/Performance.

export interface PublishedContentHandle {
  recordingId: string;
  /** The Programme/Performance created by publishedRecordingAtVenue, if any. */
  performanceId: string | null;
  programmeId: string | null;
  cleanup: () => Promise<void>;
}

async function deleteRecording(recordingId: string) {
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.deleteMany({ where: { id: recordingId } });
}

/** Publishes a minimal Recording attached to the given Works and/or Performance. */
export async function publishRecordingFor(input: {
  actorId: string;
  workIds?: string[];
  performanceId?: string;
  title?: string;
}): Promise<PublishedContentHandle> {
  const draft = await createDraftRecording({
    slug: `helper-published-${randomUUID().slice(0, 12)}`,
    actorId: input.actorId,
    title: input.title ?? `Helper Published Recording ${randomUUID().slice(0, 8)}`,
  });
  if (input.performanceId) {
    await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, input.actorId, { performanceId: input.performanceId });
  }
  for (const workId of input.workIds ?? []) {
    await attachWorkToRevision(draft.currentDraftRevision!.id, workId, input.actorId);
  }
  await publishCurrentDraft(draft.id, input.actorId);

  return {
    recordingId: draft.id,
    performanceId: input.performanceId ?? null,
    programmeId: null,
    cleanup: () => deleteRecording(draft.id),
  };
}

/**
 * Makes a Venue discoverable: creates a Programme + Performance at the Venue
 * and publishes a Recording of that Performance. cleanup() removes all of it
 * (Recording, Performance, Programme) but never the Venue itself.
 */
export async function publishedRecordingAtVenue(input: { actorId: string; venueId: string }): Promise<PublishedContentHandle> {
  const programme = await createProgramme({
    slug: `helper-programme-${randomUUID().slice(0, 12)}`,
    title: `Helper Programme ${randomUUID().slice(0, 8)}`,
    actorId: input.actorId,
  });
  const performance = await createPerformance({ programmeId: programme.id, venueId: input.venueId, actorId: input.actorId });
  const recording = await publishRecordingFor({ actorId: input.actorId, performanceId: performance.id });

  return {
    recordingId: recording.recordingId,
    performanceId: performance.id,
    programmeId: programme.id,
    cleanup: async () => {
      await recording.cleanup();
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: performance.id } });
      await prisma.performance.deleteMany({ where: { id: performance.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: programme.id } });
      await prisma.programme.deleteMany({ where: { id: programme.id } });
    },
  };
}
