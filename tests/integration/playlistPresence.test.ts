import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../modules/db/client";
import { approveExposure, revokeExposure } from "../../modules/db/repositories/videoExposureRepository";
import { hasPublishedPlaylistPage } from "../../modules/db/repositories/playlistPageRepository";
import { setReviewHold } from "../../modules/db/repositories/unlistedReviewRepository";

// F8 — the "is there a Playlists page to link to" check that runs on every public page view: correct, and a fixed, small number of queries however many
// playlist pages exist. Isolated test database, synthetic data only.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
let actorId = "";
const videoIds: string[] = [];
const videoPageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;

async function videoPage(privacy: "public" | "unlisted") {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `s${TAG}${n}`.slice(0, 11), title: `Presence ${n}`, privacyStatus: privacy, observabilityState: "OBSERVED" } });
  videoIds.push(video.id);
  const page = await prisma.youTubeVideoPage.create({ data: { slug: `presence-${TAG}-${n}`, youtubeVideoId: video.id, status: "PUBLISHED", createdById: actorId, updatedById: actorId } });
  videoPageIds.push(page.id);
  return { video, page };
}
async function publishedPlaylist(memberPageIds: string[]) {
  const id = randomUUID();
  playlistIds.push(id);
  await prisma.playlistPage.create({ data: { id, slug: `presence-pl-${TAG}-${++counter}`, title: "P", status: "PUBLISHED", publishedTitle: "P", publishedMemberIds: memberPageIds, publishedVersion: 1, publishedAt: new Date(), createdById: actorId, updatedById: actorId } });
  return id;
}
async function clearAll() {
  await prisma.videoExposureApproval.deleteMany({ where: { playlistPageId: { in: playlistIds } } }); // approvals restrict deleting their playlist page
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  playlistIds.length = 0;
}

function countQueries(run: () => Promise<unknown>) {
  const spies = [
    vi.spyOn(prisma.playlistPage, "findMany"),
    vi.spyOn(prisma.playlistPage, "findFirst"),
    vi.spyOn(prisma.youTubeVideoPage, "findMany"),
    vi.spyOn(prisma.youTubeVideoPage, "findFirst"),
    vi.spyOn(prisma.playlistPageItem, "findMany"),
    vi.spyOn(prisma.editorialContent, "findMany"),
  ];
  return run().then(() => {
    const total = spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
    spies.forEach((spy) => spy.mockRestore());
    return total;
  });
}

beforeAll(async () => {
  actorId = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `presence-${TAG}@musicmadras.test`, name: "Presence", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
}, T);

afterAll(async () => {
  await clearAll();
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...videoPageIds, ...videoIds] } }, { actorId }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: videoPageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: actorId } });
}, T);

describe("hasPublishedPlaylistPage", () => {
  it("is false with no published playlist page, and with published pages none of whose members a visitor may see", async () => {
    await clearAll();
    expect(await hasPublishedPlaylistPage()).toBe(false);
    const hidden = await videoPage("unlisted"); // unlisted and not approved for the playlist
    await publishedPlaylist([hidden.page.id]);
    await publishedPlaylist([]); // nothing in it
    expect(await hasPublishedPlaylistPage()).toBe(false);
  }, T);

  it("is true as soon as ONE page has a visible member (public video, or unlisted with a PLAYLIST approval for that playlist), and follows revocation and holds", async () => {
    await clearAll();
    const unlisted = await videoPage("unlisted");
    const playlist = await publishedPlaylist([unlisted.page.id]);
    expect(await hasPublishedPlaylistPage()).toBe(false);

    await approveExposure({ videoPageId: unlisted.page.id, scope: "PAGE", actorId });
    await prisma.playlistPageItem.create({ data: { playlistPageId: playlist, videoPageId: unlisted.page.id, position: 1, addedById: actorId } });
    expect(await hasPublishedPlaylistPage()).toBe(false); // page approval alone is not enough for a playlist
    await approveExposure({ videoPageId: unlisted.page.id, scope: "PLAYLIST", playlistPageId: playlist, actorId });
    expect(await hasPublishedPlaylistPage()).toBe(true);

    await revokeExposure({ videoPageId: unlisted.page.id, scope: "PLAYLIST", playlistPageId: playlist, actorId });
    expect(await hasPublishedPlaylistPage()).toBe(false); // revocation is immediate: nothing about this check is remembered

    const open = await videoPage("public");
    await publishedPlaylist([open.page.id]);
    expect(await hasPublishedPlaylistPage()).toBe(true);
    await setReviewHold({ videoId: open.video.id, hold: "RIGHTS", actorId });
    expect(await hasPublishedPlaylistPage()).toBe(false); // a hold removes it
  }, T);

  it("uses a fixed, small number of queries however many playlist pages exist — visible or not", async () => {
    await clearAll();
    for (let i = 0; i < 12; i++) await publishedPlaylist([(await videoPage("public")).page.id]);
    const visibleQueries = await countQueries(() => hasPublishedPlaylistPage());
    expect(visibleQueries).toBeLessThanOrEqual(2);

    await clearAll();
    for (let i = 0; i < 12; i++) await publishedPlaylist([(await videoPage("unlisted")).page.id]); // 12 pages, none visible
    let result = true;
    const hiddenQueries = await countQueries(async () => {
      result = await hasPublishedPlaylistPage();
    });
    expect(result).toBe(false);
    expect(hiddenQueries).toBeLessThanOrEqual(2); // the old check made about 2 per page here
  }, T);
});
