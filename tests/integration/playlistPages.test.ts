import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import {
  PLAYLIST_FAILED_DEDUPE,
  PLAYLIST_REGRESSION_DEDUPE,
  addPlaylistMember,
  approvePlaylistInclusion,
  archivePlaylistPage,
  createPlaylistPage,
  evaluateDraftQuality,
  findPublishedPlaylistBySlug,
  hasPublishedPlaylistPage,
  listPublishedPlaylistPages,
  loadPlaylistForStudio,
  movePlaylistMember,
  publishPlaylistPage,
  removePlaylistMember,
  revokePlaylistInclusion,
  runPlaylistQualitySweep,
  unarchivePlaylistPage,
  unpublishPlaylistPage,
  updatePlaylistDraft,
} from "../../modules/db/repositories/playlistPageRepository";
import { listPublishedVideoPages } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { approveExposure, revokeExposure } from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { PlaylistConflictError, PlaylistInvalidError, PlaylistMemberError, PlaylistQualityError } from "../../modules/mmke/playlists/playlistErrors";
import { ApprovalPrerequisiteError } from "../../modules/mmke/catalogue/videoExposureErrors";
import { approveInclusionAction, archiveAction, publishAction, saveDraftAction, unpublishAction, addMemberAction } from "../../app/(studio)/studio/(protected)/catalogue/playlists/[id]/actions";

// Phase 6K-4 — playlist pages against the isolated test database: curated membership, draft vs published snapshot, the quality rubric on the
// CURRENT draft, deduplicated notifications, per-playlist approval of unlisted videos, revalidation, and authorization. Synthetic data only.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR" } as const;
const videoIds: string[] = [];
const videoPageIds: string[] = [];
const playlistIds: string[] = [];
const youtubePlaylistIds: string[] = [];
let counter = 0;

async function makeVideo(opts: { privacy?: string | null; observed?: "OBSERVED" | "NOT_OBSERVED"; publish?: boolean } = {}) {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({
    data: { youtubeVideoId: `l${TAG}${n}`.slice(0, 11), title: `Playlist video ${TAG} ${n}`, privacyStatus: opts.privacy === undefined ? "public" : opts.privacy, observabilityState: opts.observed ?? "OBSERVED", publishedAt: new Date(Date.now() - n * 3_600_000) },
  });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  videoPageIds.push(page.id);
  if (opts.publish !== false) await publishVideoPage(page.id, users.admin);
  return { video, pageId: page.id };
}

async function makePlaylist(title?: string) {
  const playlist = await createPlaylistPage({ title: title ?? `Playlist ${TAG} ${++counter}`, actorId: users.admin });
  playlistIds.push(playlist.id);
  return playlist;
}

async function setSetting(key: string, value: number | boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  await updateSiteSetting({ key, value, expectedVersion: row?.version ?? 0, actorId: users.admin });
}
/** A page with `count` public videos and a complete draft, ready to publish under the file's relaxed settings. */
async function readyPlaylist(count = 2) {
  const playlist = await makePlaylist();
  const members = [];
  for (let i = 0; i < count; i++) {
    const v = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, actorId: users.admin });
    members.push(v);
  }
  const fresh = await prisma.playlistPage.findUniqueOrThrow({ where: { id: playlist.id } });
  await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: "A short account of what this playlist is.", seoDescription: "Search text." } });
  return { playlist, members };
}
const current = (id: string) => prisma.playlistPage.findUniqueOrThrow({ where: { id } });
const notification = (key: string) => prisma.studioNotification.findUnique({ where: { dedupeKey: key } });

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
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6k4-${who}-${TAG}@musicmadras.test`, name: `Playlist ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
  // Relaxed thresholds for this file; the checks themselves are exercised explicitly below.
  await setSetting("playlistQuality.minContextInputs", 0);
  await setSetting("playlistQuality.minEligibleVideos", 2);
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { startsWith: "playlist-quality-" } } }); // raised by saves and checks since F6
  await prisma.studioNotification.deleteMany({ where: { OR: playlistIds.flatMap((id) => [{ dedupeKey: PLAYLIST_FAILED_DEDUPE(id) }, { dedupeKey: PLAYLIST_REGRESSION_DEDUPE(id) }]) } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "playlistQuality." } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...playlistIds, ...videoPageIds] } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: videoPageIds } } }); // cascades items and approvals
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.youTubePlaylist.deleteMany({ where: { id: { in: youtubePlaylistIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("creating and drafting", () => {
  it("makes unique slugs, validates the title, and records who created it", async () => {
    const a = await makePlaylist(`Advent ${TAG}`);
    const b = await makePlaylist(`Advent ${TAG}`);
    expect(a.slug).not.toBe(b.slug);
    expect(b.slug).toMatch(/-2$/);
    await expect(createPlaylistPage({ title: "   ", actorId: users.admin })).rejects.toBeInstanceOf(PlaylistInvalidError);
    await expect(createPlaylistPage({ title: "x".repeat(161), actorId: users.admin })).rejects.toBeInstanceOf(PlaylistInvalidError);
    expect(a).toMatchObject({ status: "DRAFT", version: 1, createdById: users.admin });
    expect(await prisma.auditLogEntry.count({ where: { entityId: a.id, action: "PLAYLIST_PAGE_CREATED" } })).toBe(1);
  }, T);

  it("starting from a YouTube playlist copies only videos that have a Music Madras page, in YouTube order, and never twice", async () => {
    const withPage1 = await makeVideo();
    const noPage = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `n${TAG}9`.slice(0, 11), title: "No page", privacyStatus: "public" } });
    videoIds.push(noPage.id);
    const withPage2 = await makeVideo();
    const yt = await prisma.youTubePlaylist.create({ data: { youtubePlaylistId: `PL${TAG}`, title: "Source playlist" } });
    youtubePlaylistIds.push(yt.id);
    for (const [position, video] of [[1, withPage2.video], [2, noPage], [3, withPage1.video]] as const) {
      await prisma.youTubePlaylistItem.create({ data: { playlistId: yt.id, youtubeVideoId: video.id, position } });
    }
    const page = await createPlaylistPage({ title: `From YouTube ${TAG}`, youtubePlaylistId: yt.id, seedMembersFromYouTube: true, actorId: users.admin });
    playlistIds.push(page.id);
    const items = await prisma.playlistPageItem.findMany({ where: { playlistPageId: page.id }, orderBy: { position: "asc" } });
    expect(items.map((i) => i.videoPageId)).toEqual([withPage2.pageId, withPage1.pageId]);
    await expect(createPlaylistPage({ title: "Again", youtubePlaylistId: yt.id, actorId: users.admin })).rejects.toBeInstanceOf(PlaylistInvalidError);
    await expect(createPlaylistPage({ title: "Ghost", youtubePlaylistId: randomUUID(), actorId: users.admin })).rejects.toBeInstanceOf(PlaylistInvalidError);
  }, T);

  it("saves a draft under optimistic concurrency, treats an unchanged save as a no-op, and enforces limits", async () => {
    const page = await makePlaylist();
    const save = (version: number, over: Partial<{ title: string; summary: string; body: string; seoDescription: string }> = {}) =>
      updatePlaylistDraft({ id: page.id, expectedVersion: version, actorId: users.admin, fields: { title: page.title, summary: "A short account of this playlist.", ...over } });
    expect(await save(1)).toEqual({ version: 2, changed: true });
    expect(await save(2)).toEqual({ version: 2, changed: false });
    await expect(save(1, { summary: "stale" })).rejects.toBeInstanceOf(PlaylistConflictError);
    await expect(save(2, { summary: "x".repeat(1001) })).rejects.toBeInstanceOf(PlaylistInvalidError);
    await expect(save(2, { title: "" })).rejects.toBeInstanceOf(PlaylistInvalidError);
    expect((await current(page.id)).version).toBe(2);
  }, T);
});

describe("curated membership", () => {
  it("adds, orders, moves and removes members; every change is a draft edit; being on YouTube grants nothing", async () => {
    const playlist = await makePlaylist();
    const [a, b, c] = [await makeVideo(), await makeVideo(), await makeVideo()];
    for (const v of [a, b, c]) expect((await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, actorId: users.admin })).added).toBe(true);
    expect((await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: a.pageId, actorId: users.admin })).added).toBe(false);
    const order = async () => (await prisma.playlistPageItem.findMany({ where: { playlistPageId: playlist.id }, orderBy: { position: "asc" } })).map((i) => i.videoPageId);
    expect(await order()).toEqual([a.pageId, b.pageId, c.pageId]);
    expect((await current(playlist.id)).version).toBe(4); // created at 1, then three adds

    expect(await movePlaylistMember({ playlistPageId: playlist.id, videoPageId: c.pageId, direction: "up", actorId: users.admin })).toEqual({ moved: true });
    expect(await order()).toEqual([a.pageId, c.pageId, b.pageId]);
    expect(await movePlaylistMember({ playlistPageId: playlist.id, videoPageId: a.pageId, direction: "up", actorId: users.admin })).toEqual({ moved: false });
    await expect(movePlaylistMember({ playlistPageId: playlist.id, videoPageId: randomUUID(), direction: "up", actorId: users.admin })).rejects.toBeInstanceOf(PlaylistMemberError);

    expect((await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: c.pageId, actorId: users.admin })).removed).toBe(true);
    expect((await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: c.pageId, actorId: users.admin })).removed).toBe(false);
    expect((await prisma.playlistPageItem.findMany({ where: { playlistPageId: playlist.id }, orderBy: { position: "asc" } })).map((i) => i.position)).toEqual([1, 2]);
    await expect(addPlaylistMember({ playlistPageId: playlist.id, videoPageId: randomUUID(), actorId: users.admin })).rejects.toBeInstanceOf(PlaylistMemberError);
  }, T);

  it("an archived page cannot be changed", async () => {
    const playlist = await makePlaylist();
    const v = await makeVideo();
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    await expect(addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, actorId: users.admin })).rejects.toBeInstanceOf(PlaylistMemberError);
    await unarchivePlaylistPage({ id: playlist.id, actorId: users.admin });
    await expect(addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, actorId: users.admin })).resolves.toMatchObject({ added: true });
  }, T);
});

describe("publication is gated by the quality rubric on the CURRENT draft", () => {
  it("a failing page stays a draft: nothing is published, nothing is recorded as live, and ONE notification says exactly what is missing", async () => {
    const playlist = await makePlaylist();
    const v = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, actorId: users.admin });
    const version = (await current(playlist.id)).version;

    const attempt = () => publishPlaylistPage({ id: playlist.id, expectedVersion: version, actorId: users.admin });
    const error = await attempt().catch((e) => e);
    expect(error).toBeInstanceOf(PlaylistQualityError);
    expect((error as PlaylistQualityError).result.failing.map((c) => c.key).sort()).toEqual(["MIN_VIDEOS", "SEARCH_DESCRIPTION", "SUMMARY"]);
    expect(await current(playlist.id)).toMatchObject({ status: "DRAFT", publishedVersion: null, publishedTitle: null, publishedMemberIds: null });
    expect(await prisma.playlistPagePublication.count({ where: { playlistPageId: playlist.id } })).toBe(0);
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();

    const first = await notification(PLAYLIST_FAILED_DEDUPE(playlist.id));
    expect(first).toMatchObject({ kind: "PLAYLIST_QUALITY_FAILED", status: "OPEN", audienceAction: "CATALOGUE_WRITE", href: `/studio/catalogue/playlists/${playlist.id}` });
    expect(first!.body).toMatch(/Add a short summary/);
    expect(first!.body).toMatch(/Only 1 video can be shown; 2 are needed/);

    await attempt().catch(() => undefined); // the same failure again is the same condition
    const again = await notification(PLAYLIST_FAILED_DEDUPE(playlist.id));
    expect(again!.id).toBe(first!.id);
    expect(again!.occurrenceCount).toBe(first!.occurrenceCount);

    // fixing one thing changes the failing SET: the notification is updated (once), not duplicated
    const fresh = await current(playlist.id);
    await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: "Now there is a summary.", seoDescription: "Now there is search text." } });
    const next = await current(playlist.id);
    await publishPlaylistPage({ id: playlist.id, expectedVersion: next.version, actorId: users.admin }).catch((e) => expect(e).toBeInstanceOf(PlaylistQualityError));
    const updated = await notification(PLAYLIST_FAILED_DEDUPE(playlist.id));
    expect(updated!.id).toBe(first!.id);
    expect(updated!.occurrenceCount).toBe(first!.occurrenceCount + 1);
    expect(updated!.body).not.toMatch(/summary/i);
    expect(await prisma.studioNotification.count({ where: { dedupeKey: PLAYLIST_FAILED_DEDUPE(playlist.id) } })).toBe(1);
  }, T);

  it("once it passes it publishes, snapshots the draft, records history and audit, and resolves the failure notification", async () => {
    const { playlist, members } = await readyPlaylist(2);
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    const page = await current(playlist.id);
    expect(page).toMatchObject({ status: "PUBLISHED", publishedVersion: page.version, publishedById: users.admin, publishedSummary: "A short account of what this playlist is." });
    expect(page.publishedMemberIds).toEqual(members.map((m) => m.pageId));
    const history = await prisma.playlistPagePublication.findMany({ where: { playlistPageId: playlist.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ kind: "PUBLISHED", version: page.version, actorId: users.admin });
    expect(await prisma.auditLogEntry.count({ where: { entityId: playlist.id, action: "PLAYLIST_PAGE_PUBLISHED" } })).toBe(1);
    expect((await notification(PLAYLIST_FAILED_DEDUPE(playlist.id)))?.status ?? "RESOLVED").toBe("RESOLVED");
  }, T);

  it("publishing needs the version the editor reviewed, and publishing the same version twice records one publication", async () => {
    const { playlist } = await readyPlaylist(2);
    const version = (await current(playlist.id)).version;
    await expect(publishPlaylistPage({ id: playlist.id, expectedVersion: version - 1, actorId: users.admin })).rejects.toBeInstanceOf(PlaylistConflictError);
    await Promise.all([publishPlaylistPage({ id: playlist.id, expectedVersion: version, actorId: users.admin }), publishPlaylistPage({ id: playlist.id, expectedVersion: version, actorId: users.admin })]);
    expect(await prisma.playlistPagePublication.count({ where: { playlistPageId: playlist.id, kind: "PUBLISHED" } })).toBe(1);
  }, T);

  it("the live page is the snapshot: later draft edits and membership changes are invisible until re-published; unpublish removes it", async () => {
    const { playlist, members } = await readyPlaylist(2);
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    const live = await findPublishedPlaylistBySlug(playlist.slug);
    expect(live!.members.map((m) => m.page.id)).toEqual(members.map((m) => m.pageId));
    expect(live!.summary).toBe("A short account of what this playlist is.");

    const extra = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: extra.pageId, actorId: users.admin });
    await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: members[0].pageId, actorId: users.admin });
    const draft = await current(playlist.id);
    await updatePlaylistDraft({ id: playlist.id, expectedVersion: draft.version, actorId: users.admin, fields: { title: "A new title", summary: "A different summary", seoDescription: "A different search text for the page." } });
    const stillLive = await findPublishedPlaylistBySlug(playlist.slug);
    expect(stillLive!.title).toBe(live!.title);
    expect(stillLive!.summary).toBe("A short account of what this playlist is.");
    expect(stillLive!.members.map((m) => m.page.id)).toEqual(members.map((m) => m.pageId)); // the removed member is still on the live page until republished

    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin }); // the new draft still has 2 shown members, so it passes
    const after = await findPublishedPlaylistBySlug(playlist.slug);
    expect(after!.title).toBe("A new title");
    expect(after!.summary).toBe("A different summary");
    expect(after!.members.map((m) => m.page.id)).toEqual([members[1].pageId, extra.pageId]);

    expect(await unpublishPlaylistPage({ id: playlist.id, actorId: users.admin })).toBe(true);
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();
    expect(await unpublishPlaylistPage({ id: playlist.id, actorId: users.admin })).toBe(false);
    expect(await prisma.playlistPagePublication.count({ where: { playlistPageId: playlist.id, kind: "UNPUBLISHED" } })).toBe(1);
  }, T);

  it("context requirement: with the default of 3 pieces of human context, a page without them cannot publish; thresholds are settings", async () => {
    const { playlist } = await readyPlaylist(2);
    await setSetting("playlistQuality.minContextInputs", 3);
    try {
      const quality = await evaluateDraftQuality(playlist.id);
      expect(quality.failing.map((c) => c.key)).toEqual(["HUMAN_CONTEXT"]);
      await expect(publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin })).rejects.toBeInstanceOf(PlaylistQualityError);
      for (let i = 0; i < 3; i++) await prisma.playlistContextInput.create({ data: { playlistPageId: playlist.id, source: "EDITOR_NOTE", status: "ACTIVE", body: `Note ${i}`, createdById: users.admin } });
      await prisma.playlistContextInput.create({ data: { playlistPageId: playlist.id, source: "EDITOR_NOTE", status: "WITHDRAWN", body: "withdrawn", createdById: users.admin } });
      expect((await evaluateDraftQuality(playlist.id)).passed).toBe(true); // only ACTIVE inputs count
    } finally {
      await setSetting("playlistQuality.minContextInputs", 0);
    }
  }, T);

  it("two pages cannot be LIVE under the same title; a draft elsewhere is no conflict, and an unpublished or archived page frees the title", async () => {
    const title = `Same title ${TAG}`;
    const first = await readyPlaylist(2);
    const second = await readyPlaylist(2);
    for (const p of [first, second]) {
      const fresh = await current(p.playlist.id);
      await updatePlaylistDraft({ id: p.playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title, summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." } });
    }
    // Two drafts with one title do not conflict: neither is live.
    expect((await evaluateDraftQuality(first.playlist.id)).passed).toBe(true);
    expect((await evaluateDraftQuality(second.playlist.id)).passed).toBe(true);
    await publishPlaylistPage({ id: first.playlist.id, expectedVersion: (await current(first.playlist.id)).version, actorId: users.admin });
    // Now the first is live, so the second cannot go live under the same title.
    expect((await evaluateDraftQuality(second.playlist.id)).failing.map((c) => c.key)).toContain("UNIQUE_TITLE");
    await expect(publishPlaylistPage({ id: second.playlist.id, expectedVersion: (await current(second.playlist.id)).version, actorId: users.admin })).rejects.toBeInstanceOf(PlaylistQualityError);
    await archivePlaylistPage({ id: first.playlist.id, actorId: users.admin }); // an archived page no longer holds the title
    expect((await evaluateDraftQuality(second.playlist.id)).passed).toBe(true);
  }, T);
});
describe("what visitors see of a member is decided per playlist by the shared rule", () => {
  it("public videos show; an unlisted video needs its page approved AND an approval for THIS playlist; private, unavailable and draft never show", async () => {
    const playlist = await makePlaylist();
    const publicVideo = await makeVideo();
    const unlisted = await makeVideo({ privacy: "unlisted" });
    const priv = await makeVideo({ privacy: "private" });
    const gone = await makeVideo({ observed: "NOT_OBSERVED" });
    const draftPage = await makeVideo({ publish: false });
    for (const v of [publicVideo, unlisted, priv, gone, draftPage]) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: v.pageId, actorId: users.admin });
    const fresh = await current(playlist.id);
    await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." } });
    await setSetting("playlistQuality.minEligibleVideos", 1);
    try {
      await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    } finally {
      await setSetting("playlistQuality.minEligibleVideos", 2);
    }
    const shown = async () => (await findPublishedPlaylistBySlug(playlist.slug))!.members.map((m) => m.page.id);
    expect(await shown()).toEqual([publicVideo.pageId]);

    await expect(approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalPrerequisiteError); // page first
    await approveExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    expect(await shown()).toEqual([publicVideo.pageId]); // page approval alone is not enough for a playlist

    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    expect(await shown()).toEqual([publicVideo.pageId, unlisted.pageId]);
    expect((await listPublishedVideoPages(100_000)).some((p) => p.page.id === unlisted.pageId)).toBe(false); // …and it did not make the video listable elsewhere

    await revokePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    expect(await shown()).toEqual([publicVideo.pageId]); // revocation removes it at once; YouTube is untouched
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: unlisted.video.id } })).privacyStatus).toBe("unlisted");

    // an approval for ANOTHER playlist grants nothing here
    const other = await makePlaylist();
    await addPlaylistMember({ playlistPageId: other.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await approvePlaylistInclusion({ playlistPageId: other.id, videoPageId: unlisted.pageId, actorId: users.admin });
    expect(await shown()).toEqual([publicVideo.pageId]);

    // revoking the video's PAGE approval removes it from every playlist
    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    expect(await shown()).toContain(unlisted.pageId);
    await revokeExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    expect(await shown()).toEqual([publicVideo.pageId]);
  }, T);

  it("membership in a YouTube playlist is not an input: a video there but not curated here is never shown", async () => {
    const curated = await makeVideo();
    const onlyOnYouTube = await makeVideo();
    const yt = await prisma.youTubePlaylist.create({ data: { youtubePlaylistId: `PX${TAG}`, title: "YT" } });
    youtubePlaylistIds.push(yt.id);
    await prisma.youTubePlaylistItem.createMany({ data: [{ playlistId: yt.id, youtubeVideoId: curated.video.id, position: 1 }, { playlistId: yt.id, youtubeVideoId: onlyOnYouTube.video.id, position: 2 }] });
    const playlist = await createPlaylistPage({ title: `Curated ${TAG}`, youtubePlaylistId: yt.id, actorId: users.admin });
    playlistIds.push(playlist.id);
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: curated.pageId, actorId: users.admin });
    const view = await loadPlaylistForStudio(playlist.id);
    expect(view!.members.map((m) => m.page.id)).toEqual([curated.pageId]);
  }, T);

  it("a published page with no member visitors may see answers as not public, and does not appear in the index", async () => {
    const { playlist, members } = await readyPlaylist(2);
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    expect((await listPublishedPlaylistPages(10_000)).some((p) => p.slug === playlist.slug)).toBe(true);
    expect(await hasPublishedPlaylistPage()).toBe(true);
    for (const m of members) await prisma.youTubeVideoPage.update({ where: { id: m.pageId }, data: { status: "DRAFT" } });
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();
    expect((await listPublishedPlaylistPages(10_000)).some((p) => p.slug === playlist.slug)).toBe(false);
  }, T);

  it("the Studio view explains why a member is not shown", async () => {
    const playlist = await makePlaylist();
    const unlisted = await makeVideo({ privacy: "unlisted" });
    const priv = await makeVideo({ privacy: "private" });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: priv.pageId, actorId: users.admin });
    const view = await loadPlaylistForStudio(playlist.id);
    expect(view!.members[0]).toMatchObject({ shown: false });
    expect(view!.members[0].whyNot).toMatch(/not been approved/i);
    expect(view!.members[1].whyNot).toMatch(/private/i);
  }, T);
});

describe("revalidation of live pages after a material change", () => {
  it("raises one deduplicated warning when a live page stops meeting the checks, never unpublishes it, and resolves when it recovers", async () => {
    const playlist = await makePlaylist();
    const a = await makeVideo();
    const b = await makeVideo({ privacy: "unlisted" });
    await approveExposure({ videoPageId: b.pageId, scope: "PAGE", actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: a.pageId, actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: b.pageId, actorId: users.admin });
    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: b.pageId, actorId: users.admin });
    const fresh = await current(playlist.id);
    await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." } });
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });

    await runPlaylistQualitySweep();
    expect(await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id))).toBeNull(); // healthy

    await revokePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: b.pageId, actorId: users.admin }); // a material change: only 1 shown now, 2 needed
    await runPlaylistQualitySweep();
    const raised = await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id));
    expect(raised).toMatchObject({ kind: "PLAYLIST_QUALITY_REGRESSION", status: "OPEN", audienceAction: "CATALOGUE_WRITE" });
    expect(raised!.body).toMatch(/Only 1 video can be shown; 2 are needed/);
    expect(raised!.body).toMatch(/still live/);
    expect((await current(playlist.id)).status).toBe("PUBLISHED"); // never unpublished automatically

    await runPlaylistQualitySweep();
    await runPlaylistQualitySweep();
    const repeated = await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id));
    expect(repeated!.id).toBe(raised!.id);
    expect(repeated!.occurrenceCount).toBe(raised!.occurrenceCount); // the same unchanged problem does not notify again

    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: b.pageId, actorId: users.admin });
    const result = await runPlaylistQualitySweep();
    expect(result.recovered).toBeGreaterThanOrEqual(1);
    expect((await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id)))!.status).toBe("RESOLVED");
  }, T);

  it("raising the minimum in settings is picked up by the next sweep", async () => {
    const { playlist } = await readyPlaylist(2);
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    await runPlaylistQualitySweep();
    expect(await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id))).toBeNull();
    await setSetting("playlistQuality.minEligibleVideos", 5);
    try {
      await runPlaylistQualitySweep();
      expect((await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id)))!.status).toBe("OPEN");
    } finally {
      await setSetting("playlistQuality.minEligibleVideos", 2);
    }
    await runPlaylistQualitySweep();
    expect((await notification(PLAYLIST_REGRESSION_DEDUPE(playlist.id)))!.status).toBe("RESOLVED");
  }, T);

  it("archiving takes a live page off the site and out of the checks", async () => {
    const { playlist } = await readyPlaylist(2);
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    expect(await findPublishedPlaylistBySlug(playlist.slug)).toBeNull();
    expect(await current(playlist.id)).toMatchObject({ status: "DRAFT" });
    expect((await current(playlist.id)).archivedAt).not.toBeNull();
    await expect(publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin })).rejects.toBeInstanceOf(PlaylistMemberError);
  }, T);
});

describe("authorization of the Studio actions", () => {
  it("an editor can draft and curate but cannot publish, unpublish, archive or approve an unlisted video for a playlist", async () => {
    const { playlist } = await readyPlaylist(2);
    const unlisted = await makeVideo({ privacy: "unlisted" });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    await approveExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    const version = (await current(playlist.id)).version;

    as("editor");
    expect(await redirectOf(() => publishAction(playlist.id, form({ expectedVersion: String(version) })))).toMatch(/permission/i);
    expect(await redirectOf(() => approveInclusionAction(playlist.id, form({ videoPageId: unlisted.pageId })))).toMatch(/permission/i);
    expect(await redirectOf(() => archiveAction(playlist.id))).toMatch(/permission/i);
    expect((await current(playlist.id)).status).toBe("DRAFT");
    expect(await prisma.videoExposureApproval.count({ where: { scope: "PLAYLIST", playlistPageId: playlist.id } })).toBe(0);

    const extra = await makeVideo();
    expect(await redirectOf(() => addMemberAction(playlist.id, form({ videoPageId: extra.pageId })))).toMatch(/added/i);
    const v2 = (await current(playlist.id)).version;
    expect(await redirectOf(() => saveDraftAction(playlist.id, form({ expectedVersion: String(v2), title: "Edited by an editor", summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." })))).toMatch(/saved/i);

    as("admin");
    const v3 = (await current(playlist.id)).version;
    expect(await redirectOf(() => publishAction(playlist.id, form({ expectedVersion: String(v3) })))).toMatch(/published/i);
    expect(await redirectOf(() => approveInclusionAction(playlist.id, form({ videoPageId: unlisted.pageId })))).toMatch(/approved for this playlist/i);
    as("editor");
    expect(await redirectOf(() => unpublishAction(playlist.id))).toMatch(/permission/i);
    expect((await current(playlist.id)).status).toBe("PUBLISHED");
    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => unpublishAction(playlist.id))).toMatch(/signin/);
    expect((await current(playlist.id)).status).toBe("PUBLISHED");
  }, T);

  it("a stale save from the editor is refused with a message and changes nothing", async () => {
    const { playlist } = await readyPlaylist(2);
    as("editor");
    const before = await current(playlist.id);
    const message = await redirectOf(() => saveDraftAction(playlist.id, form({ expectedVersion: String(before.version - 1), title: "Stale", summary: "A short account of this playlist." })));
    expect(message).toMatch(/changed since you opened it/i);
    expect((await current(playlist.id)).title).toBe(before.title);
  }, T);
});
