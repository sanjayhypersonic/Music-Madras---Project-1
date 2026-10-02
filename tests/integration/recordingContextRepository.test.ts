import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createProgramme, addProgrammeItem } from "../../modules/db/repositories/programmeRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";
import { createOrganisation } from "../../modules/db/repositories/organisationRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { addPerformerToPerformance, createPerformance } from "../../modules/db/repositories/performanceRepository";
import {
  archiveRecording,
  attachWorkToRevision,
  createDraftRecording,
  forkDraftFromPublished,
  publishCurrentDraft,
  updateDraftRevisionContent,
} from "../../modules/db/repositories/recordingRepository";
import { attachMediaToRevision } from "../../modules/db/repositories/mediaResourceRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { createCollection, addRecordingToCollection, publishCollection } from "../../modules/db/repositories/collectionRepository";
import { approveSource, attachSourceToEntity, createSource, disableSource, rejectSource } from "../../modules/db/repositories/sourceRepository";
import { createCitation } from "../../modules/db/repositories/citationRepository";
import { createRightsInformation, attachRightsInformationToEntity } from "../../modules/db/repositories/rightsInformationRepository";
import { getRecordingContext } from "../../modules/db/repositories/recordingContextRepository";
import { FakeSourceRetrievalAdapter } from "../../modules/ai/retrieval/fakeSourceRetrievalAdapter";

// Phase 6H-3 — proves the Recording Context Assembler's real-database
// wiring (getRecordingContext): visibility/mode gates, real provenance
// aggregation, no-writes safety, and no private-data leakage. Pure
// shaping/gap/determinism logic is covered by
// tests/unit/assembleRecordingContext.test.ts instead — this file only
// tests what actually requires a real database.

const TEST_TAG = "phase6h3";
const TEST_EMAIL = `${TEST_TAG}-integration-test@musicmadras.test`;

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6H-3 Test User", role: "EDITOR", status: "ACTIVE", passwordHash: "not-a-real-hash" },
  });
}

interface Fixture {
  user: { id: string };
  composer: { id: string };
  work: { id: string };
  programme: { id: string };
  venue: { id: string };
  organisation: { id: string };
  artist: { id: string };
  performance: { id: string };
  recordingId: string;
}

/** Full canonical chain, published, with no media/collection/provenance attached yet — callers add those as needed. */
async function createPublishedRecordingFixture(): Promise<Fixture> {
  const user = await createTestUser();
  const organisation = await createOrganisation({ slug: uniqueSlug("organisation"), name: `Test Organisation ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
  const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
  const programme = await createProgramme({ slug: uniqueSlug("programme"), title: "Test Programme", actorId: user.id });
  await addProgrammeItem({ programmeId: programme.id, musicalWorkId: work.id, movement: "I. Allegro", actorId: user.id });
  const venue = await createVenue({ slug: uniqueSlug("venue"), name: "Test Venue", type: "CHURCH", organisationId: organisation.id, actorId: user.id });
  const performance = await createPerformance({ programmeId: programme.id, venueId: venue.id, performanceDate: new Date("2020-05-01"), actorId: user.id });
  const artist = await createArtist({ slug: uniqueSlug("artist"), name: `Test Artist ${randomUUID().slice(0, 8)}`, actorId: user.id });
  await addPerformerToPerformance(performance.id, artist.id, "Soloist", user.id);

  const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Test Recording" });
  await updateDraftRevisionContent(draft.id, draft.currentDraftRevision!.updatedAt, user.id, { performanceId: performance.id });
  await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
  const published = await publishCurrentDraft(draft.id, user.id);

  return { user, composer, work, programme, venue, organisation, artist, performance, recordingId: published.id };
}

async function cleanupFixture(fixture: Fixture, extra: { videoId?: string; videoPageId?: string; collectionId?: string; sourceId?: string; rightsId?: string } = {}) {
  if (extra.collectionId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Collection", entityId: extra.collectionId } });
    await prisma.collection.delete({ where: { id: extra.collectionId } });
  }
  if (extra.videoPageId) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: extra.videoPageId } });
    await prisma.youTubeVideoPage.delete({ where: { id: extra.videoPageId } });
  }
  if (extra.videoId) {
    await prisma.youTubeVideo.delete({ where: { id: extra.videoId } });
  }
  if (extra.sourceId) {
    await prisma.entitySource.deleteMany({ where: { sourceId: extra.sourceId } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "Source", entityId: extra.sourceId } });
    await prisma.source.delete({ where: { id: extra.sourceId } });
  }
  if (extra.rightsId) {
    await prisma.entityRights.deleteMany({ where: { rightsInformationId: extra.rightsId } });
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RightsInformation", entityId: extra.rightsId } });
    await prisma.rightsInformation.delete({ where: { id: extra.rightsId } });
  }

  const revisions = await prisma.recordingRevision.findMany({ where: { recordingId: fixture.recordingId }, select: { id: true } });
  const revisionIds = revisions.map((r) => r.id);
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: fixture.recordingId } });
  if (revisionIds.length > 0) {
    await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisionIds } } });
  }
  await prisma.recording.delete({ where: { id: fixture.recordingId } }); // cascades RecordingRevision -> RecordingRevisionWork/MediaResource

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Performance", entityId: fixture.performance.id } });
  await prisma.performance.delete({ where: { id: fixture.performance.id } }); // cascades PerformancePerformer
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: fixture.artist.id } });
  await prisma.artist.delete({ where: { id: fixture.artist.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Programme", entityId: fixture.programme.id } });
  await prisma.programme.delete({ where: { id: fixture.programme.id } }); // cascades ProgrammeItem
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: fixture.venue.id } });
  await prisma.venue.delete({ where: { id: fixture.venue.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Organisation", entityId: fixture.organisation.id } });
  await prisma.organisation.delete({ where: { id: fixture.organisation.id } });

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: fixture.work.id } });
  await prisma.musicalWork.delete({ where: { id: fixture.work.id } });
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: fixture.composer.id } });
  await prisma.composer.delete({ where: { id: fixture.composer.id } });

  await prisma.studioUser.deleteMany({ where: { id: fixture.user.id } });
}

describe("A. Not-found / lifecycle states", () => {
  it("returns NOT_FOUND for an unknown recording id", async () => {
    const result = await getRecordingContext(randomUUID());
    expect(result).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("returns ARCHIVED for an archived recording, regardless of mode", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      await archiveRecording(fixture.recordingId, fixture.user.id);
      expect(await getRecordingContext(fixture.recordingId, "PUBLISHED")).toEqual({ ok: false, reason: "ARCHIVED" });
      expect(await getRecordingContext(fixture.recordingId, "DRAFT")).toEqual({ ok: false, reason: "ARCHIVED" });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns NO_DRAFT_REVISION when a published recording has no open draft", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const result = await getRecordingContext(fixture.recordingId, "DRAFT");
      expect(result).toEqual({ ok: false, reason: "NO_DRAFT_REVISION" });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("returns NO_PUBLISHED_REVISION for a brand-new draft recording with no published revision yet", async () => {
    const user = await createTestUser();
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id });
    try {
      const result = await getRecordingContext(draft.id, "PUBLISHED");
      expect(result).toEqual({ ok: false, reason: "NO_PUBLISHED_REVISION" });
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: draft.id } });
      await prisma.recording.delete({ where: { id: draft.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("B. Canonical relationship surfacing", () => {
  it("resolves the full graph: works, composer, performance, venue, organisation, and participants", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.context.identity.recordingId).toBe(fixture.recordingId);
      expect(result.context.identity.mode).toBe("PUBLISHED");
      expect(result.context.works).toHaveLength(1);
      expect(result.context.works[0].id).toBe(fixture.work.id);
      expect(result.context.composers.map((c) => c.id)).toContain(fixture.composer.id);

      expect(result.context.performance?.id).toBe(fixture.performance.id);
      expect(result.context.performance?.venue.id).toBe(fixture.venue.id);
      expect(result.context.performance?.venue.organisation?.id).toBe(fixture.organisation.id);
      expect(result.context.performance?.performers.map((p) => p.id)).toContain(fixture.artist.id);
      expect(result.context.performance?.programme?.id).toBe(fixture.programme.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("reports performance = null and a PERFORMANCE gap for a recording with only a direct work attachment", async () => {
    const user = await createTestUser();
    const composer = await createComposer({ slug: uniqueSlug("composer"), name: `Test Composer ${randomUUID().slice(0, 8)}`, actorId: user.id });
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Test Work", composerId: composer.id, actorId: user.id });
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "No Performance Recording" });
    await attachWorkToRevision(draft.currentDraftRevision!.id, work.id, user.id);
    const published = await publishCurrentDraft(draft.id, user.id);
    try {
      const result = await getRecordingContext(published.id);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.context.performance).toBeNull();
      expect(result.context.works).toHaveLength(1);
      expect(result.context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).toContain("PERFORMANCE:MISSING");
    } finally {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: published.id } });
      await prisma.recording.delete({ where: { id: published.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: work.id } });
      await prisma.musicalWork.delete({ where: { id: work.id } });
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composer.id } });
      await prisma.composer.delete({ where: { id: composer.id } });
      await prisma.studioUser.deleteMany({ where: { id: user.id } });
    }
  });
});

describe("C. Draft vs. published revision semantics", () => {
  it("PUBLISHED mode reflects the live published title; DRAFT mode reflects in-progress edits invisible to PUBLISHED", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const forked = await forkDraftFromPublished(fixture.recordingId, fixture.user.id);
      await updateDraftRevisionContent(fixture.recordingId, forked.updatedAt, fixture.user.id, { educationalListeningGuide: "Draft-only listening guide." });

      const publishedView = await getRecordingContext(fixture.recordingId, "PUBLISHED");
      const draftView = await getRecordingContext(fixture.recordingId, "DRAFT");

      expect(publishedView.ok).toBe(true);
      expect(draftView.ok).toBe(true);
      if (!publishedView.ok || !draftView.ok) return;

      expect(publishedView.context.editorial.educationalListeningGuide).toBeNull();
      expect(draftView.context.editorial.educationalListeningGuide).toBe("Draft-only listening guide.");
      expect(draftView.context.identity.mode).toBe("DRAFT");
    } finally {
      await cleanupFixture(fixture);
    }
  });
});

describe("D. YouTube media handling", () => {
  it("preserves the YouTube description verbatim and includes a public slug only once the video page is public", async () => {
    const fixture = await createPublishedRecordingFixture();
    const video = await prisma.youTubeVideo.create({
      data: {
        youtubeVideoId: uniqueSlug("video"),
        title: "Concert Recording",
        description: "Recorded live at Test Venue.\n#chennai",
        channelId: `${TEST_TAG}-channel`,
        privacyStatus: "public",
        observabilityState: "OBSERVED",
      },
    });
    const revision = await prisma.recording.findUnique({ where: { id: fixture.recordingId }, select: { currentPublishedRevisionId: true } });
    await attachMediaToRevision({
      recordingRevisionId: revision!.currentPublishedRevisionId!,
      provider: "YOUTUBE",
      role: "PRIMARY_VIDEO",
      youtubeVideoId: video.id,
      actorId: fixture.user.id,
    });
    const videoPage = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: fixture.user.id });

    try {
      const beforePublish = await getRecordingContext(fixture.recordingId);
      expect(beforePublish.ok).toBe(true);
      if (beforePublish.ok) {
        expect(beforePublish.context.media).toHaveLength(1);
        expect(beforePublish.context.media[0].description).toBe("Recorded live at Test Venue.\n#chennai");
        expect(beforePublish.context.media[0].publicSlug).toBeNull();
      }

      await publishVideoPage(videoPage.id, fixture.user.id);
      const afterPublish = await getRecordingContext(fixture.recordingId);
      expect(afterPublish.ok).toBe(true);
      if (afterPublish.ok) {
        expect(afterPublish.context.media[0].publicSlug).toBe(videoPage.slug);
      }
    } finally {
      await cleanupFixture(fixture, { videoId: video.id, videoPageId: videoPage.id });
    }
  });
});

describe("E. Collections, published-only visibility", () => {
  it("includes a published Collection but excludes a draft Collection", async () => {
    const fixture = await createPublishedRecordingFixture();
    let publishedCollectionId: string | null = null;
    let draftCollectionId: string | null = null;
    try {
      const publishedCollection = await createCollection({ slug: uniqueSlug("collection-published"), title: "Published Collection", actorId: fixture.user.id });
      publishedCollectionId = publishedCollection.id;
      await addRecordingToCollection(publishedCollection.id, fixture.recordingId, fixture.user.id);
      await publishCollection(publishedCollection.id, fixture.user.id);

      const draftCollection = await createCollection({ slug: uniqueSlug("collection-draft"), title: "Draft Collection", actorId: fixture.user.id });
      draftCollectionId = draftCollection.id;
      await addRecordingToCollection(draftCollection.id, fixture.recordingId, fixture.user.id);

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const collectionIds = result.context.collections.map((c) => c.id);
      expect(collectionIds).toContain(publishedCollectionId);
      expect(collectionIds).not.toContain(draftCollectionId);
    } finally {
      await prisma.auditLogEntry.deleteMany({
        where: { entityType: "Collection", entityId: { in: [publishedCollectionId, draftCollectionId].filter((id): id is string => id !== null) } },
      });
      if (publishedCollectionId) await prisma.collection.delete({ where: { id: publishedCollectionId } });
      if (draftCollectionId) await prisma.collection.delete({ where: { id: draftCollectionId } });
      await cleanupFixture(fixture);
    }
  });
});

describe("F. Provenance aggregation across Recording, Work, and Composer", () => {
  it("surfaces an APPROVED Source attached to the Work and a RightsInformation attached to the Composer", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "A Historical Source", actorId: fixture.user.id });
    const rights = await createRightsInformation({ holder: "Test Holder", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await attachRightsInformationToEntity({ entityType: "COMPOSER", entityId: fixture.composer.id, rightsInformationId: rights.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.context.provenance.sources.map((s) => s.id)).toContain(source.id);
      expect(result.context.provenance.sources.find((s) => s.id === source.id)?.approvalState).toBe("APPROVED");
      expect(result.context.provenance.rights.map((r) => r.id)).toContain(rights.id);
      expect(result.context.completeness.hasProvenance).toBe(true);
      expect(result.context.completeness.gaps.map((g) => `${g.field}:${g.state}`)).not.toContain("PROVENANCE:MISSING");
    } finally {
      await cleanupFixture(fixture, { sourceId: source.id, rightsId: rights.id });
    }
  });

  it("Phase 6H-8 — excludes an UNREVIEWED Source entirely from the assembled context", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Not Yet Reviewed", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      // Deliberately never approved — default state is UNREVIEWED.

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.context.provenance.sources.map((s) => s.id)).not.toContain(source.id);
    } finally {
      await cleanupFixture(fixture, { sourceId: source.id });
    }
  });

  it("Phase 6H-8 — excludes a REJECTED Source from the assembled context", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Rejected Source", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await rejectSource(source.id, fixture.user.id);

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.context.provenance.sources.map((s) => s.id)).not.toContain(source.id);
    } finally {
      await cleanupFixture(fixture, { sourceId: source.id });
    }
  });

  it("Phase 6H-8 — excludes a DISABLED Source (previously approved, later disabled) from the assembled context", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Disabled Source", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);
      await disableSource(source.id, fixture.user.id);

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.context.provenance.sources.map((s) => s.id)).not.toContain(source.id);
    } finally {
      await cleanupFixture(fixture, { sourceId: source.id });
    }
  });

  it("Phase 6H-8 — an APPROVED Source's Citation text reaches RecordingContext via the real retrieval adapter", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Cited Source", actorId: fixture.user.id });
    let citationId: string | null = null;
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);
      const citation = await createCitation({ text: "A verified excerpt about this work.", sourceId: source.id, actorId: fixture.user.id });
      citationId = citation.id;

      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contextSource = result.context.provenance.sources.find((s) => s.id === source.id);
      expect(contextSource?.citations).toEqual([{ id: citation.id, text: "A verified excerpt about this work." }]);
    } finally {
      if (citationId) await prisma.citation.deleteMany({ where: { id: citationId } });
      await cleanupFixture(fixture, { sourceId: source.id });
    }
  });

  it("Phase 6H-8 — a retrieval failure degrades to no citation text rather than failing context assembly", async () => {
    const fixture = await createPublishedRecordingFixture();
    const source = await createSource({ title: "Retrieval Will Fail", actorId: fixture.user.id });
    try {
      await attachSourceToEntity({ entityType: "WORK", entityId: fixture.work.id, sourceId: source.id, actorId: fixture.user.id });
      await approveSource(source.id, fixture.user.id);

      const failingAdapter = new FakeSourceRetrievalAdapter({ mode: "UNAVAILABLE" });
      const result = await getRecordingContext(fixture.recordingId, "PUBLISHED", failingAdapter);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const contextSource = result.context.provenance.sources.find((s) => s.id === source.id);
      expect(contextSource).toBeDefined();
      expect(contextSource?.citations).toEqual([]);
    } finally {
      await cleanupFixture(fixture, { sourceId: source.id });
    }
  });
});

describe("G. Read-only and data-minimization safety", () => {
  it("performs no database writes: row counts are unchanged after assembling context", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const countsBefore = await Promise.all([
        prisma.recording.count(),
        prisma.recordingRevision.count(),
        prisma.auditLogEntry.count(),
        prisma.mediaResource.count(),
      ]);

      await getRecordingContext(fixture.recordingId);
      await getRecordingContext(fixture.recordingId, "DRAFT"); // exercises the NO_DRAFT_REVISION path too

      const countsAfter = await Promise.all([
        prisma.recording.count(),
        prisma.recordingRevision.count(),
        prisma.auditLogEntry.count(),
        prisma.mediaResource.count(),
      ]);

      expect(countsAfter).toEqual(countsBefore);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("never leaks the Studio user's email or password hash into the assembled context", async () => {
    const fixture = await createPublishedRecordingFixture();
    try {
      const result = await getRecordingContext(fixture.recordingId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const serialized = JSON.stringify(result.context);
      expect(serialized).not.toContain(TEST_EMAIL);
      expect(serialized).not.toContain("not-a-real-hash");
      expect(serialized).not.toContain(fixture.user.id);
    } finally {
      await cleanupFixture(fixture);
    }
  });
});
