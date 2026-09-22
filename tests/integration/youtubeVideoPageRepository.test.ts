import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import {
  approveUnlistedPublication,
  archiveVideoPage,
  createDraftVideoPage,
  findById,
  findByYouTubeVideoId,
  findBySlug,
  findPublishedBySlug,
  listVideoPages,
  publishVideoPage,
  revokeUnlistedApproval,
  unarchiveVideoPage,
  unpublishVideoPage,
  updateEditorialFields,
} from "../../modules/db/repositories/youtubeVideoPageRepository";
import type { ObservabilityState } from "@prisma/client";

// Phase 6G-1B: exercises the real, Prisma-backed YouTubeVideoPage
// repository against the configured development Postgres database. Per
// the Phase 6F-Correction incident, this file NEVER calls
// modules/youtube/sync-engine's runYouTubeSync, and never queries a
// table's *entire* contents in a way that would be sensitive to the 226
// real YouTubeVideo rows already present — every fixture here is a fresh,
// test-prefixed YouTubeVideo/StudioUser row created and torn down by this
// file alone, and every repository call this file makes is scoped to a
// specific id/slug it already knows, never a global scan.

const TEST_EMAIL = "phase6g1-integration-test@musicmadras.test";
const TEST_VIDEO_ID_1 = "phase6g1-test-video-1";
const TEST_VIDEO_ID_2 = "phase6g1-test-video-2";

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-1B Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function createTestVideo(
  youtubeVideoId: string,
  title: string,
  overrides: { privacyStatus?: string; observabilityState?: ObservabilityState } = {}
) {
  return prisma.youTubeVideo.create({
    data: {
      youtubeVideoId,
      title,
      channelId: "phase6g1-test-channel",
      privacyStatus: overrides.privacyStatus ?? "public",
      observabilityState: overrides.observabilityState ?? "OBSERVED",
    },
  });
}

async function cleanup() {
  const testVideoIds = [TEST_VIDEO_ID_1, TEST_VIDEO_ID_2];
  const videos = await prisma.youTubeVideo.findMany({ where: { youtubeVideoId: { in: testVideoIds } }, select: { id: true } });
  const videoIds = videos.map((v) => v.id);
  const pages = await prisma.youTubeVideoPage.findMany({ where: { youtubeVideoId: { in: videoIds } }, select: { id: true } });
  const pageIds = pages.map((p) => p.id);

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: { in: pageIds } } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { youtubeVideoId: { in: testVideoIds } } });
  await prisma.studioUser.deleteMany({ where: { email: TEST_EMAIL } });
}

describe("YouTubeVideoPage repository against a real database", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("creates a draft page for an existing YouTubeVideo, with a deterministic slug and DRAFT status", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Phase 6G-1B Test Video");

    const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    expect(page.status).toBe("DRAFT");
    expect(page.youtubeVideoId).toBe(video.id);
    expect(page.slug).toBe(`phase-6g-1b-test-video-${video.youtubeVideoId.toLowerCase()}`);
    expect(page.createdById).toBe(user.id);
    expect(page.updatedById).toBe(user.id);
  });

  it("rejects creating a second page for a YouTubeVideo that already has one", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Phase 6G-1B Test Video");

    await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    await expect(createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id })).rejects.toThrow();

    const count = await prisma.youTubeVideoPage.count({ where: { youtubeVideoId: video.id } });
    expect(count).toBe(1);
  });

  it("rejects creating a page for a YouTubeVideo that does not exist", async () => {
    const user = await createTestUser();
    await expect(createDraftVideoPage({ youtubeVideoId: randomUUID(), actorId: user.id })).rejects.toThrow();
  });

  it("enforces the slug unique constraint at the database level", async () => {
    const user = await createTestUser();
    const video1 = await createTestVideo(TEST_VIDEO_ID_1, "Same Title");
    const video2 = await createTestVideo(TEST_VIDEO_ID_2, "Same Title");

    const page1 = await createDraftVideoPage({ youtubeVideoId: video1.id, actorId: user.id });
    const page2 = await createDraftVideoPage({ youtubeVideoId: video2.id, actorId: user.id });

    // Distinct videos with an identical title still get distinct slugs (the immutable video ID disambiguates).
    expect(page1.slug).not.toBe(page2.slug);
  });

  it("finds a page by its YouTubeVideo, and by its slug", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Findable Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const byVideo = await findByYouTubeVideoId(video.id);
    expect(byVideo?.id).toBe(created.id);

    const bySlug = await findBySlug(created.slug);
    expect(bySlug?.id).toBe(created.id);

    const byId = await findById(created.id);
    expect(byId?.id).toBe(created.id);
  });

  it("updates curatorNote and SEO fields without touching identity or status", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Editable Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const updated = await updateEditorialFields(created.id, {
      curatorNote: "A short curator's note.",
      seoMetaTitle: "Custom SEO Title",
      seoMetaDescription: "Custom SEO description.",
      actorId: user.id,
    });

    expect(updated.curatorNote).toBe("A short curator's note.");
    expect(updated.seoMetaTitle).toBe("Custom SEO Title");
    expect(updated.seoMetaDescription).toBe("Custom SEO description.");
    expect(updated.slug).toBe(created.slug);
    expect(updated.status).toBe("DRAFT");
  });

  it("slug immutability: a later YouTube title change does not alter the existing page's slug", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Original Title Before Rename");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    const originalSlug = created.slug;

    // Simulate what a future sync pass does to YouTubeVideo.title — never touching YouTubeVideoPage.
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { title: "Renamed Title After Sync" } });

    const stillFound = await findById(created.id);
    expect(stillFound?.slug).toBe(originalSlug);

    const byOriginalSlug = await findBySlug(originalSlug);
    expect(byOriginalSlug?.id).toBe(created.id);
  });

  it("publishes a draft page whose video is public and available, and audit-logs it", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Publishable Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const published = await publishVideoPage(created.id, user.id);
    expect(published.status).toBe("PUBLISHED");

    const auditRows = await prisma.auditLogEntry.findMany({ where: { entityType: "YouTubeVideoPage", entityId: created.id, action: "VIDEO_PAGE_PUBLISHED" } });
    expect(auditRows).toHaveLength(1);
  });

  it("Phase 6G-2A: publishing an unlisted video's page is allowed (I) — status becomes PUBLISHED but it remains non-public until approved", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Unlisted Video", { privacyStatus: "unlisted" });
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const published = await publishVideoPage(created.id, user.id);
    expect(published.status).toBe("PUBLISHED");

    const stillNotPublic = await findPublishedBySlug(created.slug);
    expect(stillNotPublic).toBeNull();
  });

  it("Phase 6G-2A: publishing a private video's page is allowed editorially but it can never become public", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Private Video", { privacyStatus: "private" });
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const published = await publishVideoPage(created.id, user.id);
    expect(published.status).toBe("PUBLISHED");
    expect(await findPublishedBySlug(created.slug)).toBeNull();

    // No approval path exists for private videos at all.
    await expect(approveUnlistedPublication(created.id, user.id)).rejects.toThrow();
  });

  it("unpublishes a published page and audit-logs it", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Round Trip Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(created.id, user.id);

    const unpublished = await unpublishVideoPage(created.id, user.id);
    expect(unpublished.status).toBe("DRAFT");

    const auditRows = await prisma.auditLogEntry.findMany({ where: { entityType: "YouTubeVideoPage", entityId: created.id, action: "VIDEO_PAGE_UNPUBLISHED" } });
    expect(auditRows).toHaveLength(1);
  });

  it("findPublishedBySlug returns the page only while it is genuinely public, and stops the moment the video goes unlisted", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Drift Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(created.id, user.id);

    const whilePublic = await findPublishedBySlug(created.slug);
    expect(whilePublic?.page.id).toBe(created.id);

    // The video drifts to unlisted on YouTube's side after a later sync — YouTubeVideoPage.status is untouched.
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { privacyStatus: "unlisted" } });

    const afterDrift = await findPublishedBySlug(created.slug);
    expect(afterDrift).toBeNull();

    const stillPublishedInStudio = await findById(created.id);
    expect(stillPublishedInStudio?.status).toBe("PUBLISHED"); // Studio's own record of the decision is untouched
  });

  it("Phase 6G-2A (D): approving an unlisted, published page makes it public", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Unlisted Approvable Video", { privacyStatus: "unlisted" });
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(created.id, user.id);
    expect(await findPublishedBySlug(created.slug)).toBeNull();

    const approved = await approveUnlistedPublication(created.id, user.id);
    expect(approved.unlistedPublicationApprovedAt).not.toBeNull();

    const result = await findPublishedBySlug(created.slug);
    expect(result?.page.id).toBe(created.id);

    const auditRows = await prisma.auditLogEntry.findMany({
      where: { entityType: "YouTubeVideoPage", entityId: created.id, action: "VIDEO_PAGE_UNLISTED_PUBLICATION_APPROVED" },
    });
    expect(auditRows).toHaveLength(1);
  });

  it("Phase 6G-2A (J): approving a still-DRAFT unlisted page does not publish it", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Unlisted Draft Approved Video", { privacyStatus: "unlisted" });
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const approved = await approveUnlistedPublication(created.id, user.id);
    expect(approved.status).toBe("DRAFT"); // approval never touches status
    expect(await findPublishedBySlug(created.slug)).toBeNull(); // still not public — status gates first
  });

  it("Phase 6G-2A (H): revoking approval immediately makes a previously-public unlisted page non-public again, without touching status", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Revocable Video", { privacyStatus: "unlisted" });
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(created.id, user.id);
    await approveUnlistedPublication(created.id, user.id);
    expect(await findPublishedBySlug(created.slug)).not.toBeNull();

    const revoked = await revokeUnlistedApproval(created.id, user.id);
    expect(revoked.unlistedPublicationApprovedAt).toBeNull();
    expect(revoked.status).toBe("PUBLISHED"); // revocation never unpublishes

    expect(await findPublishedBySlug(created.slug)).toBeNull();

    const auditRows = await prisma.auditLogEntry.findMany({
      where: { entityType: "YouTubeVideoPage", entityId: created.id, action: "VIDEO_PAGE_UNLISTED_PUBLICATION_REVOKED" },
    });
    expect(auditRows).toHaveLength(1);
  });

  it("rejects approving a page whose video is not currently unlisted", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Public Video, Not Approvable");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    await expect(approveUnlistedPublication(created.id, user.id)).rejects.toThrow();
  });

  it("findPublishedBySlug returns null for a DRAFT page even if the video is fully public", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Still Draft Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const result = await findPublishedBySlug(created.slug);
    expect(result).toBeNull();
  });

  it("archives and unarchives a page, audit-logging both, and archiving hides it from the public gate", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Archivable Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(created.id, user.id);

    const archived = await archiveVideoPage(created.id, user.id);
    expect(archived.archivedAt).not.toBeNull();

    const whileArchived = await findPublishedBySlug(created.slug);
    expect(whileArchived).toBeNull();

    const archiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "YouTubeVideoPage", entityId: created.id, action: "VIDEO_PAGE_ARCHIVED" } });
    expect(archiveAudit).toHaveLength(1);

    const unarchived = await unarchiveVideoPage(created.id, user.id);
    expect(unarchived.archivedAt).toBeNull();

    const afterUnarchive = await findPublishedBySlug(created.slug);
    expect(afterUnarchive?.page.id).toBe(created.id); // status is still PUBLISHED from before, and no longer archived

    const unarchiveAudit = await prisma.auditLogEntry.findMany({ where: { entityType: "YouTubeVideoPage", entityId: created.id, action: "VIDEO_PAGE_UNARCHIVED" } });
    expect(unarchiveAudit).toHaveLength(1);
  });

  it("the linked YouTubeVideo row is never modified by any repository operation", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Untouched Video");
    const before = await prisma.youTubeVideo.findUnique({ where: { id: video.id } });

    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await updateEditorialFields(created.id, { curatorNote: "note", actorId: user.id });
    await publishVideoPage(created.id, user.id);
    await unpublishVideoPage(created.id, user.id);
    await archiveVideoPage(created.id, user.id);
    await unarchiveVideoPage(created.id, user.id);

    const after = await prisma.youTubeVideo.findUnique({ where: { id: video.id } });
    expect(after).toEqual(before);
  });

  it("creating and managing a video page never creates a Recording, MediaResource, or Collection", async () => {
    const [recordingBefore, mediaResourceBefore, collectionBefore] = await Promise.all([
      prisma.recording.count(),
      prisma.mediaResource.count(),
      prisma.collection.count(),
    ]);

    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "No Side Effects Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });
    await publishVideoPage(created.id, user.id);

    const [recordingAfter, mediaResourceAfter, collectionAfter] = await Promise.all([
      prisma.recording.count(),
      prisma.mediaResource.count(),
      prisma.collection.count(),
    ]);

    expect(recordingAfter).toBe(recordingBefore);
    expect(mediaResourceAfter).toBe(mediaResourceBefore);
    expect(collectionAfter).toBe(collectionBefore);
  });

  it("listVideoPages includes a newly created page regardless of status", async () => {
    const user = await createTestUser();
    const video = await createTestVideo(TEST_VIDEO_ID_1, "Listed Video");
    const created = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: user.id });

    const all = await listVideoPages();
    expect(all.some((p) => p.id === created.id)).toBe(true);
  });
});
