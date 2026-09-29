import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import {
  archiveLearningGuide,
  attachRecordingToLearningGuide,
  attachWorkToLearningGuide,
  createLearningGuide,
  listPublicLearningGuides,
  listPublicLearningGuidesForRecording,
  listPublicLearningGuidesForWorkIds,
  listPublicLearningGuidesPage,
  publishLearningGuide,
  restoreLearningGuide,
  unpublishLearningGuide,
} from "../../modules/db/repositories/learningGuideRepository";
import {
  getComposerEntityPageData,
  getPublicLearningGuidePageData,
  getPublicRecordingPageData,
  getPublicWorkPageData,
  getArtistEntityPageData,
  getVenueEntityPageData,
} from "../../modules/db/repositories/entityRelationshipsRepository";
import { createComposer } from "../../modules/db/repositories/composerRepository";
import { createMusicalWork, archiveMusicalWork } from "../../modules/db/repositories/musicalWorkRepository";
import { createDraftRecording, publishCurrentDraft } from "../../modules/db/repositories/recordingRepository";
import { createArtist } from "../../modules/db/repositories/artistRepository";
import { createVenue } from "../../modules/db/repositories/venueRepository";

// Phase 6G-17: proves the public read-side of the Learning Guide Museum
// experience against the real database — the visibility rule
// (status === "PUBLISHED" && archivedAt === null), the /learning index,
// the /learning/[slug] detail assembly, and reverse discovery from
// Composer/MusicalWork/Recording (and its deliberate absence from
// Artist/Venue). Real DB, disposable test-prefixed fixtures only.

const TEST_TAG = "phase6g17";

function uniqueSlug(base: string): string {
  return `${TEST_TAG}-${base}-${randomUUID().slice(0, 8)}`;
}

function uniqueTitle(base: string): string {
  return `${base} ${randomUUID().slice(0, 8)}`;
}

async function createTestUser() {
  return prisma.studioUser.create({
    data: {
      id: randomUUID(),
      email: `${TEST_TAG}-${randomUUID().slice(0, 8)}@musicmadras.test`,
      name: "Phase 6G-17 Test User",
      role: "EDITOR",
      status: "ACTIVE",
    },
  });
}

async function cleanupLearningGuide(learningGuideId: string) {
  await prisma.auditLogEntry.deleteMany({ where: { entityType: "LearningGuide", entityId: learningGuideId } });
  await prisma.learningGuide.delete({ where: { id: learningGuideId } }).catch(() => {});
}

describe("Public LearningGuide visibility rule against a real database", () => {
  let learningGuideId: string | null = null;
  let userId: string | null = null;

  afterEach(async () => {
    if (learningGuideId) {
      await cleanupLearningGuide(learningGuideId).catch(() => {});
      learningGuideId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("excludes a DRAFT guide from the public index and detail lookup", async () => {
    const user = await createTestUser();
    userId = user.id;
    const marker = randomUUID().slice(0, 8);
    const guide = await createLearningGuide({ slug: uniqueSlug("draft"), title: `Draft ${marker} Guide`, actorId: user.id });
    learningGuideId = guide.id;

    const page = await listPublicLearningGuidesPage(1, 200);
    expect(page.items.map((g) => g.id)).not.toContain(guide.id);

    expect(await getPublicLearningGuidePageData(guide.slug)).toBeNull();
  });

  it("excludes a PUBLISHED-but-archived guide from the public index and detail lookup", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("pub-archived"), title: uniqueTitle("Published Archived Guide"), actorId: user.id });
    learningGuideId = guide.id;
    await publishLearningGuide(guide.id, user.id);
    await archiveLearningGuide(guide.id, user.id);

    const page = await listPublicLearningGuidesPage(1, 200);
    expect(page.items.map((g) => g.id)).not.toContain(guide.id);
    expect(await getPublicLearningGuidePageData(guide.slug)).toBeNull();
  });

  it("returns null for a nonexistent slug", async () => {
    expect(await getPublicLearningGuidePageData(`${TEST_TAG}-does-not-exist-${randomUUID()}`)).toBeNull();
  });

  it("includes a PUBLISHED, non-archived guide in the public index and detail lookup", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({
      slug: uniqueSlug("visible"),
      title: uniqueTitle("Visible Guide"),
      contentMarkdown: "# Heading\n\nSome real content here.",
      difficultyLevel: "Beginner",
      estimatedReadingTimeMinutes: 6,
      actorId: user.id,
    });
    learningGuideId = guide.id;
    await publishLearningGuide(guide.id, user.id);

    const page = await listPublicLearningGuidesPage(1, 200);
    const summary = page.items.find((g) => g.id === guide.id);
    expect(summary).toBeDefined();
    expect(summary!.excerpt).toContain("Some real content here.");

    const detail = await getPublicLearningGuidePageData(guide.slug);
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe(guide.title);
    expect(detail!.difficultyLevel).toBe("Beginner");
  });

  it("republishing after unpublish, and restoring after archive, make a guide visible again exactly when both gates hold", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("cycle"), title: uniqueTitle("Cycle Guide"), actorId: user.id });
    learningGuideId = guide.id;

    await publishLearningGuide(guide.id, user.id);
    expect(await getPublicLearningGuidePageData(guide.slug)).not.toBeNull();

    await unpublishLearningGuide(guide.id, user.id);
    expect(await getPublicLearningGuidePageData(guide.slug)).toBeNull();

    await publishLearningGuide(guide.id, user.id);
    await archiveLearningGuide(guide.id, user.id);
    expect(await getPublicLearningGuidePageData(guide.slug)).toBeNull(); // published but archived

    await restoreLearningGuide(guide.id, user.id);
    expect(await getPublicLearningGuidePageData(guide.slug)).not.toBeNull(); // published and restored
  });

  it("is never included in the sitemap's unbounded public list while DRAFT", async () => {
    const user = await createTestUser();
    userId = user.id;
    const guide = await createLearningGuide({ slug: uniqueSlug("sitemap-draft"), title: uniqueTitle("Sitemap Draft Guide"), actorId: user.id });
    learningGuideId = guide.id;

    const all = await listPublicLearningGuides();
    expect(all.map((g) => g.id)).not.toContain(guide.id);

    await publishLearningGuide(guide.id, user.id);
    const allAfterPublish = await listPublicLearningGuides();
    expect(allAfterPublish.map((g) => g.id)).toContain(guide.id);
  });
});

describe("Reverse discovery (Composer/MusicalWork/Recording) against a real database", () => {
  let learningGuideId: string | null = null;
  let userId: string | null = null;
  let composerId: string | null = null;
  let musicalWorkId: string | null = null;
  let recordingId: string | null = null;
  let artistId: string | null = null;
  let venueId: string | null = null;

  afterEach(async () => {
    if (learningGuideId) {
      await cleanupLearningGuide(learningGuideId).catch(() => {});
      learningGuideId = null;
    }
    if (recordingId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Recording", entityId: recordingId } });
      const revisions = await prisma.recordingRevision.findMany({ where: { recordingId }, select: { id: true } });
      if (revisions.length > 0) {
        await prisma.auditLogEntry.deleteMany({ where: { entityType: "RecordingRevision", entityId: { in: revisions.map((r) => r.id) } } });
      }
      await prisma.recording.delete({ where: { id: recordingId } }).catch(() => {});
      recordingId = null;
    }
    if (musicalWorkId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "MusicalWork", entityId: musicalWorkId } });
      await prisma.musicalWork.delete({ where: { id: musicalWorkId } }).catch(() => {});
      musicalWorkId = null;
    }
    if (composerId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Composer", entityId: composerId } });
      await prisma.composer.delete({ where: { id: composerId } }).catch(() => {});
      composerId = null;
    }
    if (artistId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Artist", entityId: artistId } });
      await prisma.artist.delete({ where: { id: artistId } }).catch(() => {});
      artistId = null;
    }
    if (venueId) {
      await prisma.auditLogEntry.deleteMany({ where: { entityType: "Venue", entityId: venueId } });
      await prisma.venue.delete({ where: { id: venueId } }).catch(() => {});
      venueId = null;
    }
    if (userId) {
      await prisma.studioUser.deleteMany({ where: { id: userId } });
      userId = null;
    }
  });

  it("surfaces a published guide on the Work page, the Composer page (via the Work), and the Recording page — but never on Artist/Venue pages", async () => {
    const user = await createTestUser();
    userId = user.id;

    const composer = await createComposer({ slug: uniqueSlug("composer"), name: uniqueTitle("Composer"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work"), title: "Discoverable Work", composerId: composer.id, actorId: user.id });
    musicalWorkId = work.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("recording"), actorId: user.id, title: "Discoverable Recording" });
    const recording = await publishCurrentDraft(draft.id, user.id);
    recordingId = recording.id;

    const guide = await createLearningGuide({ slug: uniqueSlug("reverse"), title: uniqueTitle("Reverse Discovery Guide"), actorId: user.id });
    learningGuideId = guide.id;
    await attachWorkToLearningGuide(guide.id, work.id, user.id);
    await attachRecordingToLearningGuide(guide.id, recording.id, user.id);
    await publishLearningGuide(guide.id, user.id);

    const workPage = await getPublicWorkPageData(work.slug);
    expect(workPage?.learningGuides.map((g) => g.id)).toEqual([guide.id]);

    const composerPage = await getComposerEntityPageData(composer.slug);
    expect(composerPage?.relatedLearningGuides?.map((g) => g.id)).toEqual([guide.id]);

    const recordingPage = await getPublicRecordingPageData(recording.slug);
    expect(recordingPage?.learningGuides.map((g) => g.id)).toEqual([guide.id]);

    // Deliberately not extended: Artist/Venue pages never surface LearningGuides.
    const artist = await createArtist({ slug: uniqueSlug("artist"), name: uniqueTitle("Artist"), actorId: user.id });
    artistId = artist.id;
    const artistPage = await getArtistEntityPageData(artist.slug);
    expect(artistPage?.relatedLearningGuides).toBeNull();

    const venue = await createVenue({ slug: uniqueSlug("venue"), name: uniqueTitle("Venue"), type: "CONCERT_HALL", actorId: user.id });
    venueId = venue.id;
    const venuePage = await getVenueEntityPageData(venue.slug);
    expect(venuePage?.relatedLearningGuides).toBeNull();
  });

  it("does not surface an unpublished guide via reverse discovery, and stops surfacing a guide once its Work is archived", async () => {
    const user = await createTestUser();
    userId = user.id;
    const composer = await createComposer({ slug: uniqueSlug("composer2"), name: uniqueTitle("Composer Two"), actorId: user.id });
    composerId = composer.id;
    const work = await createMusicalWork({ slug: uniqueSlug("work2"), title: "Another Work", composerId: composer.id, actorId: user.id });
    musicalWorkId = work.id;

    const guide = await createLearningGuide({ slug: uniqueSlug("unpub-reverse"), title: uniqueTitle("Unpublished Reverse Guide"), actorId: user.id });
    learningGuideId = guide.id;
    await attachWorkToLearningGuide(guide.id, work.id, user.id);
    // Deliberately never published.

    const guides = await listPublicLearningGuidesForWorkIds([work.id]);
    expect(guides).toHaveLength(0);

    await publishLearningGuide(guide.id, user.id);
    expect(await listPublicLearningGuidesForWorkIds([work.id])).toHaveLength(1);

    await archiveMusicalWork(work.id, user.id);
    const workPage = await getPublicWorkPageData(work.slug);
    expect(workPage).toBeNull(); // the Work itself is no longer public — nothing to surface a guide on
  });

  it("does not surface a guide attached to a Recording that has not been published", async () => {
    const user = await createTestUser();
    userId = user.id;
    const draft = await createDraftRecording({ slug: uniqueSlug("unpub-recording"), actorId: user.id, title: "Unpublished Recording" });
    recordingId = draft.id;

    const guide = await createLearningGuide({ slug: uniqueSlug("unpub-rec-guide"), title: uniqueTitle("Guide For Unpublished Recording"), actorId: user.id });
    learningGuideId = guide.id;
    await attachRecordingToLearningGuide(guide.id, draft.id, user.id);
    await publishLearningGuide(guide.id, user.id);

    expect(await listPublicLearningGuidesForRecording(draft.id)).toHaveLength(0);
  });
});
