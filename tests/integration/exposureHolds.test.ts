import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import sitemap from "../../app/sitemap";
import { prisma } from "../../modules/db/client";
import { loadFeaturedPlan, pinFeaturedVideo } from "../../modules/db/repositories/featuredVideoRepository";
import { loadPlaylistEvidence } from "../../modules/db/repositories/playlistContextRepository";
import { addPlaylistMember, createPlaylistPage, findPublishedPlaylistBySlug, publishPlaylistPage, updatePlaylistDraft } from "../../modules/db/repositories/playlistPageRepository";
import { resetSiteSetting, updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { clearReviewHold, getVideoHold, setReviewHold } from "../../modules/db/repositories/unlistedReviewRepository";
import { searchPublicVideoCatalogue } from "../../modules/db/repositories/videoCatalogueRepository";
import { approveExposure, listActiveApprovals } from "../../modules/db/repositories/videoExposureRepository";
import { approveUnlistedPublication, createDraftVideoPage, findPublicVideoPagesByYouTubeVideoIds, findPublishedBySlug, listPublishedVideoPages, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { ApprovalBlockedByHoldError } from "../../modules/mmke/catalogue/videoExposureErrors";
import { clearVideoHoldAction, setVideoHoldAction } from "../../app/(studio)/studio/(protected)/catalogue/videos/[videoId]/actions";

// F4 — an active rights/copyright/privacy hold denies exposure at the final shared check, on every public surface, for public AND unlisted
// videos, whatever else is approved. Isolated test database, synthetic data only.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR" } as const;
const videoIds: string[] = [];
const pageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;

async function makeVideo(privacy: "public" | "unlisted" = "public") {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({
    data: { youtubeVideoId: `h${TAG}${n}`.slice(0, 11), title: `Hold subject ${TAG} ${n}`, privacyStatus: privacy, observabilityState: "OBSERVED", currentViewCount: 1_000_000 + n, publishedAt: new Date(Date.now() - n * 3_600_000) },
  });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return { video, page };
}

async function setSetting(key: string, value: number | boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  await updateSiteSetting({ key, value, expectedVersion: row?.version ?? 0, actorId: users.admin });
}
async function clearSetting(key: string) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  if (row) await resetSiteSetting({ key, expectedVersion: row.version, actorId: users.admin });
}

const isListed = async (pageId: string) => (await listPublishedVideoPages(100_000)).some((p) => p.page.id === pageId);
const inCatalogue = async (title: string) => (await searchPublicVideoCatalogue({ q: title, page: 1, pageSize: 50, sort: "newest" })).total > 0;
const as = (who: keyof typeof users) => mockGetCurrentStudioSession.mockResolvedValue({ user: { id: users[who], role: roles[who], name: who, email: `${who}@example.test`, status: "ACTIVE" } });
async function redirectOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const digest = (err as { digest?: unknown })?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) return decodeURIComponent(digest.split(";").slice(2, -2).join(";").replace(/\+/g, " "));
    throw err;
  }
  throw new Error("did not redirect");
}
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.set(k, v);
  return data;
};

beforeAll(async () => {
  for (const who of Object.keys(roles) as (keyof typeof users)[]) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kf4-${who}-${TAG}@musicmadras.test`, name: `Hold ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { startsWith: "playlist-quality-" } } }); // raised by saves and checks since F6
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "playlistQuality." } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds, ...playlistIds] } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("a hold on a PUBLIC video removes it from every public surface", () => {
  it("direct page, lists, catalogue, related-video lookup, featured, sitemap and playlist membership — and clearing the hold needs no approval", async () => {
    const subject = await makeVideo("public");
    const other = await makeVideo("public");
    await pinFeaturedVideo({ videoPageId: subject.page.id, actorId: users.admin });

    // a published playlist page that includes it
    await setSetting("playlistQuality.minContextInputs", 0);
    await setSetting("playlistQuality.minEligibleVideos", 1);
    const playlist = await createPlaylistPage({ title: `Hold playlist ${TAG}`, actorId: users.admin });
    playlistIds.push(playlist.id);
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: subject.page.id, actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: other.page.id, actorId: users.admin });
    const fresh = await prisma.playlistPage.findUniqueOrThrow({ where: { id: playlist.id } });
    await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." } });
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await prisma.playlistPage.findUniqueOrThrow({ where: { id: playlist.id } })).version, actorId: users.admin });

    const origin = process.env.PUBLIC_SITE_URL ?? "";
    const visible = async () => ({
      direct: (await findPublishedBySlug(subject.page.slug)) !== null,
      listed: await isListed(subject.page.id),
      catalogue: await inCatalogue(subject.video.title ?? ""),
      related: (await findPublicVideoPagesByYouTubeVideoIds([subject.video.id])).length > 0,
      featured: (await loadFeaturedPlan()).entries.some((e) => e.page.id === subject.page.id),
      sitemap: (await sitemap()).some((e) => e.url.endsWith(`/videos/${subject.page.slug}`)),
      playlist: (await findPublishedPlaylistBySlug(playlist.slug))!.members.some((m) => m.page.id === subject.page.id),
      evidence: (await loadPlaylistEvidence(playlist.id)).evidence.items.some((i) => i.text.includes(subject.video.title ?? "∅")),
    });
    void origin;
    expect(await visible()).toEqual({ direct: true, listed: true, catalogue: true, related: true, featured: true, sitemap: true, playlist: true, evidence: true });

    await setReviewHold({ videoId: subject.video.id, hold: "COPYRIGHT", note: "Claim received", actorId: users.admin });
    expect(await visible()).toEqual({ direct: false, listed: false, catalogue: false, related: false, featured: false, sitemap: false, playlist: false, evidence: false });
    expect((await findPublishedPlaylistBySlug(playlist.slug))!.members.map((m) => m.page.id)).toEqual([other.page.id]); // the rest of the playlist is unaffected
    expect(await getVideoHold(subject.video.id)).toMatchObject({ holdReason: "COPYRIGHT", holdNote: "Claim received" });

    // the pin is kept, and Studio says it is not shown
    const plan = await loadFeaturedPlan();
    expect(plan.pinned.find((p) => p.row.videoPageId === subject.page.id)).toMatchObject({ currentlyShown: false });

    await clearReviewHold({ videoId: subject.video.id, actorId: users.admin });
    expect((await visible()).direct).toBe(true); // a public video needs no approval, so it simply returns
    expect(await getVideoHold(subject.video.id)).toBeNull();
    await clearSetting("playlistQuality.minContextInputs");
    await clearSetting("playlistQuality.minEligibleVideos");
  }, T);
});

describe("a hold on an UNLISTED video", () => {
  it("revokes its approvals, blocks every way of approving it, and clearing the hold restores nothing", async () => {
    const { video, page } = await makeVideo("unlisted");
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
    expect(await isListed(page.id)).toBe(true);

    await setReviewHold({ videoId: video.id, hold: "RIGHTS", actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect(await isListed(page.id)).toBe(false);
    expect((await listActiveApprovals([page.id])).get(page.id) ?? []).toEqual([]);
    await expect(approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalBlockedByHoldError);
    await expect(approveUnlistedPublication(page.id, users.admin)).rejects.toBeInstanceOf(ApprovalBlockedByHoldError);

    await clearReviewHold({ videoId: video.id, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toBeNull(); // clearing approves nothing
    expect(await isListed(page.id)).toBe(false);
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin }); // re-approval is explicit
    expect(await findPublishedBySlug(page.slug)).not.toBeNull();
  }, T);

  it("cannot be bypassed by restoring the approval data underneath (an old-version write, a restore): the hold still wins", async () => {
    const { video, page } = await makeVideo("unlisted");
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
    // a hold row is placed directly, WITHOUT the revocation that setReviewHold would perform
    await prisma.videoExposureReview.create({ data: { youtubeVideoId: video.id, state: "DECLINED", proposalFingerprint: "x", holdReason: "PRIVACY" } });
    expect((await listActiveApprovals([page.id])).get(page.id)).toHaveLength(2); // approvals are intact…
    expect(await findPublishedBySlug(page.slug)).toBeNull(); // …and still nothing is shown
    expect(await isListed(page.id)).toBe(false);
  }, T);
});

describe("recording and clearing holds from Studio", () => {
  it("needs RECORDING_PUBLISH; works for a video that is not in the unlisted queue; refuses unknown kinds", async () => {
    const { video, page } = await makeVideo("public");
    as("editor");
    expect(await redirectOf(() => setVideoHoldAction(video.id, form({ hold: "RIGHTS" })))).toMatch(/permission/i);
    expect(await getVideoHold(video.id)).toBeNull();

    as("admin");
    expect(await redirectOf(() => setVideoHoldAction(video.id, form({ hold: "NONSENSE" })))).toMatch(/Choose the kind/i);
    await redirectOf(() => setVideoHoldAction(video.id, form({ hold: "RIGHTS", note: "Rights holder objected" })));
    expect(await getVideoHold(video.id)).toMatchObject({ holdReason: "RIGHTS" });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect(await prisma.auditLogEntry.count({ where: { entityId: video.id, action: "VIDEO_REVIEW_HOLD_SET" } })).toBe(1);

    as("editor");
    expect(await redirectOf(() => clearVideoHoldAction(video.id))).toMatch(/permission/i);
    expect(await getVideoHold(video.id)).not.toBeNull();
    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => clearVideoHoldAction(video.id))).toMatch(/permission/i);

    as("admin");
    await redirectOf(() => clearVideoHoldAction(video.id));
    expect(await getVideoHold(video.id)).toBeNull();
    expect(await findPublishedBySlug(page.slug)).not.toBeNull();
  }, T);
});
