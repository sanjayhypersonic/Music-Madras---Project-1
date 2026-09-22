import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { prisma } from "../../modules/db/client";
import {
  findYouTubeVideoById,
  listYouTubeVideosForStudioCatalogue,
} from "../../modules/db/repositories/youtubeVideoRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";

// Phase 6G-1C — the two new Studio-facing read functions added to the
// existing (sync-owned) youtubeVideoRepository. Real database, disposable
// test-prefixed fixtures only — the 226 real synchronized videos are read
// incidentally (the list function necessarily returns them too) but are
// never asserted about individually and never mutated.

const TEST_EMAIL = "phase6g1c-integration-test@musicmadras.test";
const TEST_VIDEO_ID_NO_PAGE = "phase6g1c-test-video-no-page";
const TEST_VIDEO_ID_UNLISTED = "phase6g1c-test-video-unlisted";
const TEST_VIDEO_ID_PUBLISHED = "phase6g1c-test-video-published";

async function createTestUser() {
  return prisma.studioUser.create({
    data: { id: randomUUID(), email: TEST_EMAIL, name: "Phase 6G-1C Test User", role: "EDITOR", status: "ACTIVE" },
  });
}

async function createTestVideo(youtubeVideoId: string, title: string, privacyStatus = "public") {
  return prisma.youTubeVideo.create({
    data: { youtubeVideoId, title, channelId: "phase6g1c-test-channel", privacyStatus, observabilityState: "OBSERVED" },
  });
}

async function cleanup() {
  const testVideoIds = [TEST_VIDEO_ID_NO_PAGE, TEST_VIDEO_ID_UNLISTED, TEST_VIDEO_ID_PUBLISHED];
  const videos = await prisma.youTubeVideo.findMany({ where: { youtubeVideoId: { in: testVideoIds } }, select: { id: true } });
  const videoIds = videos.map((v) => v.id);
  const pages = await prisma.youTubeVideoPage.findMany({ where: { youtubeVideoId: { in: videoIds } }, select: { id: true } });
  const pageIds = pages.map((p) => p.id);

  await prisma.auditLogEntry.deleteMany({ where: { entityType: "YouTubeVideoPage", entityId: { in: pageIds } } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { youtubeVideoId: { in: testVideoIds } } });
  await prisma.studioUser.deleteMany({ where: { email: TEST_EMAIL } });
}

describe("Studio video catalogue reads (youtubeVideoRepository) against a real database", () => {
  afterEach(async () => {
    await cleanup();
  });

  it("findYouTubeVideoById returns the full video record, and null for a nonexistent id", async () => {
    const video = await createTestVideo(TEST_VIDEO_ID_NO_PAGE, "Findable By Id");
    const found = await findYouTubeVideoById(video.id);
    expect(found?.youtubeVideoId).toBe(TEST_VIDEO_ID_NO_PAGE);
    expect(found?.title).toBe("Findable By Id");

    const missing = await findYouTubeVideoById(randomUUID());
    expect(missing).toBeNull();
  });

  it("listYouTubeVideosForStudioCatalogue includes every synchronized video, unlisted ones included, with the correct catalogue-page summary for each state", async () => {
    const user = await createTestUser();
    const noPageVideo = await createTestVideo(TEST_VIDEO_ID_NO_PAGE, "No Page Video");
    const unlistedVideo = await createTestVideo(TEST_VIDEO_ID_UNLISTED, "Unlisted Video", "unlisted");
    const publishedVideo = await createTestVideo(TEST_VIDEO_ID_PUBLISHED, "Published Video");

    const draftPage = await createDraftVideoPage({ youtubeVideoId: unlistedVideo.id, actorId: user.id });
    const publishedPage = await createDraftVideoPage({ youtubeVideoId: publishedVideo.id, actorId: user.id });
    await publishVideoPage(publishedPage.id, user.id);

    const all = await listYouTubeVideosForStudioCatalogue();
    const byId = new Map(all.map((v) => [v.id, v]));

    // No public-visibility filter applied at all — the unlisted video is present, same as any other.
    const noPageRow = byId.get(noPageVideo.id);
    expect(noPageRow).toBeDefined();
    expect(noPageRow?.videoPage).toBeNull();

    const unlistedRow = byId.get(unlistedVideo.id);
    expect(unlistedRow).toBeDefined();
    expect(unlistedRow?.privacyStatus).toBe("unlisted");
    expect(unlistedRow?.videoPage?.id).toBe(draftPage.id);
    expect(unlistedRow?.videoPage?.status).toBe("DRAFT");

    const publishedRow = byId.get(publishedVideo.id);
    expect(publishedRow).toBeDefined();
    expect(publishedRow?.videoPage?.status).toBe("PUBLISHED");

    // The 226 real synchronized videos are necessarily also present — never asserted about individually, never mutated.
    expect(all.length).toBeGreaterThanOrEqual(3);
  });
});
