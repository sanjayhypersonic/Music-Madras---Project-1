import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import { markNotificationRead } from "../../modules/db/repositories/studioNotificationRepository";
import {
  PLAYLIST_FAILED_DEDUPE,
  addPlaylistMember,
  approvePlaylistInclusion,
  archivePlaylistPage,
  createPlaylistPage,
  publishPlaylistPage,
  removePlaylistMember,
  revokePlaylistInclusion,
  runPlaylistQualitySweep,
  syncPlaylistQualityNotification,
  updatePlaylistDraft,
} from "../../modules/db/repositories/playlistPageRepository";
import { acceptDraftProposal, addContextNote, answerInterviewQuestion, withdrawContextInput } from "../../modules/db/repositories/playlistContextRepository";
import { resetSiteSetting, updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import { approveExposure } from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { checkQualityAction, saveDraftAction } from "../../app/(studio)/studio/(protected)/catalogue/playlists/[id]/actions";

// F6 — the "cannot be published yet" notification is raised when a failure is DETECTED (save, change of videos/context/approvals, explicit check),
// not only when someone tries to publish, and resolved when the draft passes. Isolated test database, synthetic data only.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor" | "contributor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR", contributor: "CONTRIBUTOR" } as const;
const videoIds: string[] = [];
const videoPageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;

async function makeVideo(privacy: "public" | "unlisted" = "public") {
  const n = ++counter;
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `q${TAG}${n}`.slice(0, 11), title: `Quality video ${TAG} ${n}`, privacyStatus: privacy, observabilityState: "OBSERVED", publishedAt: new Date("2021-12-19T00:00:00Z") } });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  await publishVideoPage(page.id, users.admin);
  videoPageIds.push(page.id);
  return { video, pageId: page.id };
}
async function makePlaylist() {
  const playlist = await createPlaylistPage({ title: `Quality playlist ${TAG} ${++counter}`, actorId: users.admin });
  playlistIds.push(playlist.id);
  return playlist;
}
async function setSetting(key: string, value: number | boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  await updateSiteSetting({ key, value, expectedVersion: row?.version ?? 0, actorId: users.admin });
}
async function clearSetting(key: string) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  if (row) await resetSiteSetting({ key, expectedVersion: row.version, actorId: users.admin });
}
const note = (id: string) => prisma.studioNotification.findUnique({ where: { dedupeKey: PLAYLIST_FAILED_DEDUPE(id) } });
const current = (id: string) => prisma.playlistPage.findUniqueOrThrow({ where: { id } });
async function save(id: string, over: Partial<{ title: string; summary: string; seoDescription: string }> = {}) {
  const page = await current(id);
  return updatePlaylistDraft({ id, expectedVersion: page.version, actorId: users.editor, fields: { title: page.title, summary: page.summary ?? "", seoDescription: page.seoDescription ?? "", ...over } });
}
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
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kf6-${who}-${TAG}@musicmadras.test`, name: `Quality ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
  await setSetting("playlistQuality.minContextInputs", 0);
  await setSetting("playlistQuality.minEligibleVideos", 2);
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { OR: playlistIds.map((id) => ({ dedupeKey: PLAYLIST_FAILED_DEDUPE(id) })) } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "playlistQuality." } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...playlistIds, ...videoPageIds] } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: videoPageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("raised when a failure is detected — without any publish attempt", () => {
  it("a blank new page raises nothing; the first save that leaves it failing raises ONE notification listing exactly what is missing", async () => {
    const playlist = await makePlaylist();
    expect(await note(playlist.id)).toBeNull(); // creation alone is not a "failure detected"
    await save(playlist.id, { title: playlist.title }); // unchanged save: still nothing to detect
    expect(await note(playlist.id)).toBeNull();

    await save(playlist.id, { summary: "" , seoDescription: "" , title: `${playlist.title} edited` });
    const raised = (await note(playlist.id))!;
    expect(raised).toMatchObject({ kind: "PLAYLIST_QUALITY_FAILED", status: "OPEN", audienceAction: "CATALOGUE_WRITE", severity: "ACTION_REQUIRED", href: `/studio/catalogue/playlists/${playlist.id}` });
    expect(raised.body).toMatch(/Add a short summary/);
    expect(raised.body).toMatch(/Only 0 videos can be shown; 2 are needed/);
    expect(raised.body).toMatch(/search description/i);
    expect(raised.body).not.toMatch(/live page/);
    expect((await current(playlist.id)).status).toBe("DRAFT"); // and nothing was published or attempted
    expect(await prisma.playlistPagePublication.count({ where: { playlistPageId: playlist.id } })).toBe(0);
  }, T);

  it("the same unchanged failure never notifies twice; a change in WHAT is missing updates it once and makes it unread again", async () => {
    const playlist = await makePlaylist();
    await save(playlist.id, { title: `${playlist.title} v2` });
    const first = (await note(playlist.id))!;
    await markNotificationRead({ id: first.id, userId: users.editor, role: "EDITOR" });
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: first.id } })).toBe(1);

    await save(playlist.id, { title: `${playlist.title} v3` }); // same failing set
    await syncPlaylistQualityNotification(playlist.id);
    await syncPlaylistQualityNotification(playlist.id);
    const same = (await note(playlist.id))!;
    expect(same.id).toBe(first.id);
    expect(same.occurrenceCount).toBe(first.occurrenceCount);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: first.id } })).toBe(1); // still read: nothing new to say

    await save(playlist.id, { summary: "Now it says what it is." }); // the SET changes: summary no longer missing
    const changed = (await note(playlist.id))!;
    expect(changed.occurrenceCount).toBe(first.occurrenceCount + 1);
    expect(changed.body).not.toMatch(/summary/i);
    expect(await prisma.studioNotificationRead.count({ where: { notificationId: first.id } })).toBe(0); // unread again
    expect(await prisma.studioNotification.count({ where: { dedupeKey: PLAYLIST_FAILED_DEDUPE(playlist.id) } })).toBe(1);
  }, T);

  it("is resolved the moment the draft passes — by a save, not by publishing — and reopens if it later fails again", async () => {
    const playlist = await makePlaylist();
    for (let i = 0; i < 2; i++) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: (await makeVideo()).pageId, actorId: users.editor });
    await save(playlist.id, { summary: "A summary." });
    expect((await note(playlist.id))!.status).toBe("OPEN"); // search description still missing
    await save(playlist.id, { seoDescription: "Search text." });
    const resolved = (await note(playlist.id))!;
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolvedReason).toMatch(/now passes the publication checks/);
    expect((await current(playlist.id)).status).toBe("DRAFT"); // resolved without publishing anything

    await save(playlist.id, { seoDescription: "" }); // fails again
    expect((await note(playlist.id))!).toMatchObject({ status: "OPEN" });
    expect((await note(playlist.id))!.occurrenceCount).toBeGreaterThan(resolved.occurrenceCount);
  }, T);

  it("a live page with draft edits that fail says the live page is unchanged", async () => {
    const playlist = await makePlaylist();
    for (let i = 0; i < 2; i++) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: (await makeVideo()).pageId, actorId: users.editor });
    await save(playlist.id, { summary: "A summary.", seoDescription: "Search text." });
    await publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin });
    expect((await note(playlist.id))?.status ?? "RESOLVED").toBe("RESOLVED");
    await save(playlist.id, { summary: "" });
    const raised = (await note(playlist.id))!;
    expect(raised.status).toBe("OPEN");
    expect(raised.title).toMatch(/has changes that cannot be published yet/);
    expect(raised.body).toMatch(/The live page is unchanged\./);
    expect((await current(playlist.id)).status).toBe("PUBLISHED");
  }, T);
});

describe("every change that can alter the result re-checks it", () => {
  async function failingWithOneVideo() {
    const playlist = await makePlaylist();
    const first = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: first.pageId, actorId: users.editor }); // raises: needs 2 videos, a summary, a search description
    await save(playlist.id, { summary: "A summary.", seoDescription: "Search text." });
    return { playlist, first };
  }

  it("adding and removing a video", async () => {
    const { playlist } = await failingWithOneVideo();
    expect((await note(playlist.id))!.status).toBe("OPEN");
    const second = await makeVideo();
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: second.pageId, actorId: users.editor });
    expect((await note(playlist.id))!.status).toBe("RESOLVED");
    await removePlaylistMember({ playlistPageId: playlist.id, videoPageId: second.pageId, actorId: users.editor });
    expect((await note(playlist.id))!.status).toBe("OPEN");
    expect((await note(playlist.id))!.body).toMatch(/Only 1 video can be shown; 2 are needed/);
  }, T);

  it("approving and revoking an unlisted video for the playlist", async () => {
    const { playlist } = await failingWithOneVideo();
    const unlisted = await makeVideo("unlisted");
    await approveExposure({ videoPageId: unlisted.pageId, scope: "PAGE", actorId: users.admin });
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.editor });
    expect((await note(playlist.id))!.status).toBe("OPEN"); // present but not yet shown on this playlist
    await approvePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    expect((await note(playlist.id))!.status).toBe("RESOLVED");
    await revokePlaylistInclusion({ playlistPageId: playlist.id, videoPageId: unlisted.pageId, actorId: users.admin });
    expect((await note(playlist.id))!.status).toBe("OPEN");
  }, T);

  it("adding, answering and withdrawing context when context is required", async () => {
    await setSetting("playlistQuality.minContextInputs", 2);
    try {
      const playlist = await makePlaylist();
      for (let i = 0; i < 2; i++) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: (await makeVideo()).pageId, actorId: users.editor });
      await save(playlist.id, { summary: "A summary.", seoDescription: "Search text." });
      expect((await note(playlist.id))!.body).toMatch(/0 pieces of distinct context recorded; 2 needed/);

      const first = await addContextNote({ playlistPageId: playlist.id, body: "A note.", actorId: users.editor });
      expect((await note(playlist.id))!.body).toMatch(/1 piece of distinct context recorded; 2 needed/);
      const question = await prisma.playlistContextInput.create({ data: { playlistPageId: playlist.id, source: "AI_QUESTION", status: "AWAITING_ANSWER", question: "Why?", createdById: users.editor } });
      await answerInterviewQuestion({ inputId: question.id, body: "Because.", actorId: users.editor });
      expect((await note(playlist.id))!.status).toBe("RESOLVED");
      await withdrawContextInput({ inputId: first.id, actorId: users.editor });
      expect((await note(playlist.id))!.status).toBe("OPEN");
    } finally {
      await setSetting("playlistQuality.minContextInputs", 0);
    }
  }, T);

  it("accepting an AI draft into the page", async () => {
    const playlist = await makePlaylist();
    for (let i = 0; i < 2; i++) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: (await makeVideo()).pageId, actorId: users.editor });
    await save(playlist.id, { seoDescription: "Search text." });
    expect((await note(playlist.id))!.body).toMatch(/Add a short summary/);
    await addContextNote({ playlistPageId: playlist.id, body: "These open the annual Advent service.", actorId: users.editor });
    const { loadPlaylistEvidence } = await import("../../modules/db/repositories/playlistContextRepository");
    const proposal = await prisma.playlistDraftProposal.create({
      data: { playlistPageId: playlist.id, target: "SUMMARY", proposedContent: "These open the annual Advent service.", claims: { schema: 2, sentences: [{ text: "These open the annual Advent service.", evidenceIds: ["context-1"], quotes: ["open the annual Advent service"], newParagraph: false }] }, evidenceFingerprint: (await loadPlaylistEvidence(playlist.id)).evidence.fingerprint, provider: "fake", model: "m", promptVersion: "p", requestedById: users.editor },
    });
    await acceptDraftProposal({ proposalId: proposal.id, expectedVersion: (await current(playlist.id)).version, actorId: users.editor, humanVerified: true });
    expect((await note(playlist.id))!.status).toBe("RESOLVED");
  }, T);
});

describe("explicit check, sweep and archive", () => {
  it("the Studio 'check now' action detects, reports and resolves — and needs CATALOGUE_WRITE", async () => {
    const playlist = await makePlaylist();
    as("contributor");
    expect(await redirectOf(() => checkQualityAction(playlist.id))).toMatch(/permission/i);
    expect(await note(playlist.id)).toBeNull();

    as("editor");
    expect(await redirectOf(() => checkQualityAction(playlist.id))).toMatch(/some required items are missing/i);
    expect((await note(playlist.id))!.status).toBe("OPEN");
    expect(await redirectOf(() => checkQualityAction(playlist.id))).toMatch(/same items are still missing/i);
    for (let i = 0; i < 2; i++) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: (await makeVideo()).pageId, actorId: users.editor });
    const versionNow = (await current(playlist.id)).version;
    expect(await redirectOf(() => saveDraftAction(playlist.id, form({ expectedVersion: String(versionNow), title: playlist.title, summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." })))).toMatch(/saved/i);
    expect((await note(playlist.id))!.status).toBe("RESOLVED");
    expect(await redirectOf(() => checkQualityAction(playlist.id))).toMatch(/passes every required check/i);
  }, T);

  it("the sweep resolves a standing notification when settings change so the draft now passes, and updates it when they make it stricter", async () => {
    const playlist = await makePlaylist();
    for (let i = 0; i < 2; i++) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: (await makeVideo()).pageId, actorId: users.editor });
    await save(playlist.id, { summary: "A short account of this playlist." }); // search description missing → open
    expect((await note(playlist.id))!.status).toBe("OPEN");

    await setSetting("playlistQuality.requireSeoDescription", false);
    try {
      await runPlaylistQualitySweep();
      expect((await note(playlist.id))!.status).toBe("RESOLVED"); // no one had to touch the page
      await setSetting("playlistQuality.minEligibleVideos", 5);
      await runPlaylistQualitySweep();
      const stricter = (await note(playlist.id))!;
      expect(stricter.status).toBe("OPEN");
      expect(stricter.body).toMatch(/Only 2 videos can be shown; 5 are needed/);
    } finally {
      await clearSetting("playlistQuality.requireSeoDescription");
      await setSetting("playlistQuality.minEligibleVideos", 2);
    }
  }, T);

  it("archiving a page resolves its notification", async () => {
    const playlist = await makePlaylist();
    await save(playlist.id, { title: `${playlist.title} archived` });
    expect((await note(playlist.id))!.status).toBe("OPEN");
    await archivePlaylistPage({ id: playlist.id, actorId: users.admin });
    expect((await note(playlist.id))!.status).toBe("RESOLVED");
  }, T);

  it("a publish attempt on a failing draft still reports the failure and keeps the one notification", async () => {
    const playlist = await makePlaylist();
    await save(playlist.id, { title: `${playlist.title} attempt` });
    const before = (await note(playlist.id))!;
    await expect(publishPlaylistPage({ id: playlist.id, expectedVersion: (await current(playlist.id)).version, actorId: users.admin })).rejects.toThrow(/cannot be published yet/);
    const after = (await note(playlist.id))!;
    expect(after.id).toBe(before.id);
    expect(after.occurrenceCount).toBe(before.occurrenceCount); // already known: not announced again
  }, T);

  it("a failure to update the notification never undoes or fails the save", async () => {
    const playlist = await makePlaylist();
    const spy = vi.spyOn(prisma.studioNotification, "findUnique").mockRejectedValueOnce(new Error("notification store unavailable"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(save(playlist.id, { title: `${playlist.title} resilient` })).resolves.toMatchObject({ changed: true });
    } finally {
      spy.mockRestore();
      errorLog.mockRestore();
    }
    expect((await current(playlist.id)).title).toMatch(/resilient/);
  }, T);
});
