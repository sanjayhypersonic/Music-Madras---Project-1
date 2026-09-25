import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { addProgrammeItem, createProgramme } from "../../modules/db/repositories/programmeRepository";
import { createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision, findPublishedRecordingSlugForYouTubeVideo } from "../../modules/db/repositories/mediaResourceRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-11 — proves findPublishedRecordingSlugForYouTubeVideo (the
// /videos/[slug] -> /recordings/[slug] back-link's sole data source)
// against the real database: it must return a slug ONLY through the real
// MediaResource -> RecordingRevision FK chain when that revision is the
// Recording's CURRENT PUBLISHED one, and never for a video with no such
// canonical relationship, an unpublished/archived Recording, or a
// MediaResource pointing at a stale (non-current) revision.

const TEST_TAG = "phase6g11vb";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-11 Video Back-link Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function createTestVideo(overrides: { privacyStatus?: string; observabilityState?: ObservabilityState } = {}) {
  return prisma.youTubeVideo.create({
    data: {
      youtubeVideoId: uniqueSlug("video"),
      title: "Back-link Test Video",
      channelId: `${TEST_TAG}-channel`,
      privacyStatus: overrides.privacyStatus ?? "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  });
}

async function createFixture(user: { id: string }) {
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Back-link Composer ${randomUUID().slice(0, 6)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Back-link Work", composerId: composer.id, actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: `Back-link Venue ${randomUUID().slice(0, 6)}`, type: "CONCERT_HALL", actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Back-link Programme", actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2019-11-11"), actorId: user.id });

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Back-link Recording" });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return { composer, work, venue, programme, performance, recordingId: published.id, recordingSlug: published.slug, publishedRevisionId: published.currentPublishedRevisionId as string };
}

async function cleanupFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisions.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }).catch(() => {});

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: fixture.programme.id } });
  await prisma.programme.delete({ where: { id: fixture.programme.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: fixture.venue.id } });
  await prisma.venue.delete({ where: { id: fixture.venue.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
  await prisma.musicalWork.delete({ where: { id: fixture.work.id } }).catch(() => {});
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } }).catch(() => {});
}

describe("findPublishedRecordingSlugForYouTubeVideo", () => {
  it("returns null for a video with no canonical MediaResource relationship at all", async () => {
    const user = await createTestUser();
    const video = await createTestVideo();
    try {
      expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBeNull();
    } finally {
      await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns the Recording's slug when the video is attached to its current published revision", async () => {
    const user = await createTestUser();
    const video = await createTestVideo();
    const fixture = await createFixture(user);
    try {
      await attachMediaToRevision({
        recordingRevisionId: fixture.publishedRevisionId,
        provider: "YOUTUBE",
        role: "PRIMARY_VIDEO",
        youtubeVideoId: video.id,
        actorId: user.id,
      });

      expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBe(fixture.recordingSlug);
    } finally {
      await cleanupFixture(fixture);
      await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns null once the Recording has been archived, even though the MediaResource FK chain still exists", async () => {
    const user = await createTestUser();
    const video = await createTestVideo();
    const fixture = await createFixture(user);
    try {
      await attachMediaToRevision({
        recordingRevisionId: fixture.publishedRevisionId,
        provider: "YOUTUBE",
        role: "PRIMARY_VIDEO",
        youtubeVideoId: video.id,
        actorId: user.id,
      });
      await archiveRecording(fixture.recordingId, user.id);

      expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });

  it("returns null when the MediaResource points at a revision that is not the Recording's current published one", async () => {
    const user = await createTestUser();
    const video = await createTestVideo();
    const fixture = await createFixture(user);
    try {
      // Attach the video to a *different*, never-published draft revision
      // created directly against the recording — not its currentPublishedRevisionId.
      const strayRevision = await prisma.recordingRevision.create({
        data: {
          recordingId: fixture.recordingId,
          revisionNumber: 999,
          revisionStatus: "DRAFT",
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await attachMediaToRevision({
        recordingRevisionId: strayRevision.id,
        provider: "YOUTUBE",
        role: "PRIMARY_VIDEO",
        youtubeVideoId: video.id,
        actorId: user.id,
      });

      expect(await findPublishedRecordingSlugForYouTubeVideo(video.id)).toBeNull();
    } finally {
      await cleanupFixture(fixture);
      await prisma.youTubeVideo.delete({ where: { id: video.id } }).catch(() => {});
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});
