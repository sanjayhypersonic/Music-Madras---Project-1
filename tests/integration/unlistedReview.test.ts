import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import { resetSiteSetting, updateSiteSetting } from "../../modules/db/repositories/siteSettingRepository";
import {
  UNLISTED_REVIEW_DEDUPE_KEY,
  clearReviewHold,
  decideReview,
  loadReviewQueue,
  runUnlistedReviewSweep,
  setReviewHold,
  type QueueItem,
} from "../../modules/db/repositories/unlistedReviewRepository";
import { approveExposure, listActiveApprovals, revokeExposure } from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, findPublishedBySlug, listPublishedVideoPages, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { ApprovalBlockedByHoldError, ApprovalPrerequisiteError } from "../../modules/mmke/catalogue/videoExposureErrors";
import { ReviewChangedError, ReviewDecisionInvalidError } from "../../modules/mmke/videoReview/reviewErrors";
import { addPlaylistMember, createPlaylistPage, findPublishedPlaylistBySlug, publishPlaylistPage, updatePlaylistDraft } from "../../modules/db/repositories/playlistPageRepository";
import { ApprovalInvalidError } from "../../modules/mmke/catalogue/videoExposureErrors";
import { decideReviewAction } from "../../app/(studio)/studio/(protected)/catalogue/unlisted-review/actions";

// Phase 6K-2 — the unlisted-video review queue against the isolated test database. Synthetic videos only; assertions are about the
// videos this file creates (other rows may exist), and files run one at a time.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR" } as const;
const videoIds: string[] = [];
const pageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;
const DAY = 86_400_000;

async function newVideo(privacy = "unlisted", observability: "OBSERVED" | "NOT_OBSERVED" = "OBSERVED") {
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `r${TAG}${++counter}`.slice(0, 11), title: `Review ${counter}`, privacyStatus: privacy, observabilityState: observability, description: "d" } });
  videoIds.push(video.id);
  return video;
}
async function newPage(videoId: string, publish = true) {
  const page = await createDraftVideoPage({ youtubeVideoId: videoId, actorId: users.admin });
  if (publish) await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return page;
}
async function item(videoId: string, now?: Date): Promise<QueueItem | undefined> {
  return (await loadReviewQueue(now)).find((i) => i.videoId === videoId);
}
const fingerprintOf = async (videoId: string) => (await item(videoId))!.fingerprint;
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
const isListed = async (pageId: string) => (await listPublishedVideoPages(100_000)).some((p) => p.page.id === pageId);
async function setSetting(key: string, value: number | boolean) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  await updateSiteSetting({ key, value, expectedVersion: row?.version ?? 0, actorId: users.admin });
}
async function clearSetting(key: string) {
  const row = await prisma.siteSetting.findUnique({ where: { key } });
  if (row) await resetSiteSetting({ key, expectedVersion: row.version, actorId: users.admin });
}
const openReminder = () => prisma.studioNotification.findUnique({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } });

beforeAll(async () => {
  for (const who of Object.keys(roles) as (keyof typeof users)[]) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6k2r-${who}-${TAG}@musicmadras.test`, name: `Review ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "unlistedReview." } } });
  await prisma.siteSetting.deleteMany({ where: { key: { startsWith: "playlistQuality." } } });
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { startsWith: "playlist-quality-" } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds] } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } }); // cascades the reviews and their decisions
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("the sweep", () => {
  it("creates a pending review only for unlisted, observed videos — never for public, private or unavailable ones", async () => {
    const unlisted = await newVideo("unlisted");
    const gone = await newVideo("unlisted", "NOT_OBSERVED");
    const open = await newVideo("public");
    const priv = await newVideo("private");
    const result = await runUnlistedReviewSweep();
    expect(result.enabled).toBe(true);
    expect(result.created).toBeGreaterThanOrEqual(1);
    expect((await item(unlisted.id))).toMatchObject({ class: "PENDING", awaitingDecision: true, state: "PENDING" });
    for (const v of [gone, open, priv]) {
      expect(await item(v.id)).toBeUndefined();
      expect(await prisma.videoExposureReview.findUnique({ where: { youtubeVideoId: v.id } })).toBeNull();
    }
  }, T);

  it("is idempotent: a second run creates and resurfaces nothing, and the notification is UNCHANGED (one row, one occurrence)", async () => {
    await newVideo("unlisted");
    await runUnlistedReviewSweep();
    const before = await openReminder();
    const again = await runUnlistedReviewSweep();
    expect(again).toMatchObject({ created: 0, resurfaced: 0, notification: "UNCHANGED" });
    const after = await openReminder();
    expect(after!.id).toBe(before!.id);
    expect(after!.occurrenceCount).toBe(before!.occurrenceCount);
    expect(await prisma.studioNotification.count({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } })).toBe(1);
    expect(after).toMatchObject({ kind: "UNLISTED_REVIEW_PENDING", audienceAction: "RECORDING_PUBLISH", status: "OPEN", href: "/studio/catalogue/unlisted-review" });
  }, T);

  it("announces a newly arrived video at once, then reminds at most once per cadence window", async () => {
    await runUnlistedReviewSweep();
    const first = await openReminder();
    await newVideo("unlisted");
    expect((await runUnlistedReviewSweep()).notification).toBe("RAISED"); // the set changed
    const second = await openReminder();
    expect(second!.occurrenceCount).toBe(first!.occurrenceCount + 1);

    const later = new Date(Date.now() + 8 * DAY); // past the default 7-day window
    expect((await runUnlistedReviewSweep(later)).notification).toBe("RAISED"); // the reminder
    expect((await runUnlistedReviewSweep(later)).notification).toBe("UNCHANGED"); // …once
    expect((await runUnlistedReviewSweep(new Date(later.getTime() + 3_600_000))).notification).toBe("UNCHANGED");
  }, T);

  it("resolves the notification when nothing awaits a decision", async () => {
    // Decide everything that is awaiting (only synthetic rows exist in the isolated database).
    await runUnlistedReviewSweep();
    for (const awaiting of (await loadReviewQueue()).filter((i) => i.awaitingDecision)) {
      await decideReview({ videoId: awaiting.videoId, expectedFingerprint: awaiting.fingerprint, decision: { kind: "DECLINE" }, actorId: users.admin });
    }
    const result = await runUnlistedReviewSweep();
    expect(result.awaiting).toBe(0);
    expect(result.notification).toBe("RESOLVED");
    expect((await openReminder())!.status).toBe("RESOLVED");
    expect((await runUnlistedReviewSweep()).notification).toBe("NONE");
  }, T);

  it("records a video that was already approved before the review existed as approved, without asking again", async () => {
    const video = await newVideo("unlisted");
    const page = await newPage(video.id);
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    const result = await runUnlistedReviewSweep();
    expect(result.created).toBe(0);
    expect(await item(video.id)).toMatchObject({ class: "APPROVED", awaitingDecision: false, state: "APPROVED" });
    expect(await prisma.videoExposureReviewDecision.count({ where: { review: { youtubeVideoId: video.id } } })).toBe(0); // no invented history
  }, T);
});

describe("deciding", () => {
  it("DEFER hides the item until it falls due, then it returns; a custom date and the setting default both work", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "DEFER", until: new Date(Date.now() + 3 * DAY) }, actorId: users.admin, note: "after the festival" });
    expect(await item(video.id)).toMatchObject({ class: "DEFERRED", awaitingDecision: false });
    await runUnlistedReviewSweep();
    expect((await item(video.id))!.awaitingDecision).toBe(false);

    const dueAt = new Date(Date.now() + 4 * DAY);
    const result = await runUnlistedReviewSweep(dueAt);
    expect(result.resurfaced).toBeGreaterThanOrEqual(1);
    expect(await item(video.id, dueAt)).toMatchObject({ class: "PENDING", awaitingDecision: true, state: "PENDING", deferUntil: null });

    // default deferral comes from the setting
    const v2 = await newVideo();
    await runUnlistedReviewSweep();
    await updateSiteSetting({ key: "unlistedReview.deferDays", value: 2, expectedVersion: 0, actorId: users.admin });
    try {
      await decideReview({ videoId: v2.id, expectedFingerprint: await fingerprintOf(v2.id), decision: { kind: "DEFER" }, actorId: users.admin });
      const until = (await item(v2.id))!.deferUntil!.getTime();
      expect(until - Date.now()).toBeGreaterThan(1.9 * DAY);
      expect(until - Date.now()).toBeLessThan(2.1 * DAY);
    } finally {
      await resetSiteSetting({ key: "unlistedReview.deferDays", expectedVersion: 1, actorId: users.admin });
    }
  }, T);

  it("refuses a deferral date in the past and a request for information with no question; records nothing", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    const expectedFingerprint = await fingerprintOf(video.id);
    await expect(decideReview({ videoId: video.id, expectedFingerprint, decision: { kind: "DEFER", until: new Date(Date.now() - DAY) }, actorId: users.admin })).rejects.toBeInstanceOf(ReviewDecisionInvalidError);
    await expect(decideReview({ videoId: video.id, expectedFingerprint, decision: { kind: "REQUEST_INFO", infoRequest: "   " }, actorId: users.admin })).rejects.toBeInstanceOf(ReviewDecisionInvalidError);
    await expect(decideReview({ videoId: video.id, expectedFingerprint, decision: { kind: "APPROVE", scopes: ["DISCOVERY"] }, actorId: users.admin })).rejects.toBeInstanceOf(ReviewDecisionInvalidError);
    expect(await prisma.videoExposureReviewDecision.count({ where: { review: { youtubeVideoId: video.id } } })).toBe(0);
    expect(await item(video.id)).toMatchObject({ class: "PENDING" });
  }, T);

  it("REQUEST_INFO and DECLINE stop the item resurfacing while it is unchanged; a material change brings either back", async () => {
    const asked = await newVideo();
    const declined = await newVideo();
    await runUnlistedReviewSweep();
    await decideReview({ videoId: asked.id, expectedFingerprint: await fingerprintOf(asked.id), decision: { kind: "REQUEST_INFO", infoRequest: "Who is the choir?" }, actorId: users.admin });
    await decideReview({ videoId: declined.id, expectedFingerprint: await fingerprintOf(declined.id), decision: { kind: "DECLINE" }, actorId: users.admin });
    await runUnlistedReviewSweep();
    expect(await item(asked.id)).toMatchObject({ class: "INFO_REQUESTED", awaitingDecision: false, infoRequest: "Who is the choir?" });
    expect(await item(declined.id)).toMatchObject({ class: "DECLINED", awaitingDecision: false });

    // view counts move constantly and must not resurface anything
    await prisma.youTubeVideo.update({ where: { id: declined.id }, data: { currentViewCount: 12345 } });
    await runUnlistedReviewSweep();
    expect((await item(declined.id))!.awaitingDecision).toBe(false);

    // a title change is material
    await prisma.youTubeVideo.update({ where: { id: asked.id }, data: { title: "Renamed after the answer" } });
    await prisma.youTubeVideo.update({ where: { id: declined.id }, data: { description: "Now described properly" } });
    const result = await runUnlistedReviewSweep();
    expect(result.resurfaced).toBeGreaterThanOrEqual(2);
    expect(await item(asked.id)).toMatchObject({ class: "PENDING", awaitingDecision: true });
    expect(await item(declined.id)).toMatchObject({ class: "PENDING", awaitingDecision: true });
  }, T);

  it("refuses a decision made against a stale fingerprint, and records nothing", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    const shown = await fingerprintOf(video.id);
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { title: "Changed while the reviewer was reading" } });
    await expect(decideReview({ videoId: video.id, expectedFingerprint: shown, decision: { kind: "DECLINE" }, actorId: users.admin })).rejects.toBeInstanceOf(ReviewChangedError);
    expect(await prisma.videoExposureReviewDecision.count({ where: { review: { youtubeVideoId: video.id } } })).toBe(0);
    expect((await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).state).toBe("PENDING");
  }, T);

  it("APPROVE needs a page; with one it records page (and listing) approvals atomically, with history and audit — and changes nothing on YouTube", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    const fp = await fingerprintOf(video.id);
    await expect(decideReview({ videoId: video.id, expectedFingerprint: fp, decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalPrerequisiteError);
    expect((await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).state).toBe("PENDING");

    const page = await newPage(video.id);
    expect(await findPublishedBySlug(page.slug)).toBeNull(); // unlisted and not yet approved
    await decideReview({ videoId: video.id, expectedFingerprint: fp, decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin, note: "Approved for the page only." });
    expect((await findPublishedBySlug(page.slug))!.discoverable).toBe(false); // reachable, not listed
    expect(await isListed(page.id)).toBe(false);

    await decideReview({ videoId: video.id, expectedFingerprint: fp, decision: { kind: "APPROVE", scopes: ["PAGE", "DISCOVERY"] }, actorId: users.admin });
    expect((await listActiveApprovals([page.id])).get(page.id)!.map((a) => a.scope).sort()).toEqual(["DISCOVERY", "PAGE"]);
    expect(await isListed(page.id)).toBe(true);

    const decisions = await prisma.videoExposureReviewDecision.findMany({ where: { review: { youtubeVideoId: video.id } }, orderBy: { createdAt: "asc" } });
    expect(decisions.map((d) => d.kind)).toEqual(["APPROVE", "APPROVE"]);
    expect(decisions[0]).toMatchObject({ actorId: users.admin, note: "Approved for the page only." });
    expect(await prisma.auditLogEntry.count({ where: { entityId: video.id, action: "VIDEO_REVIEW_DECIDED" } })).toBe(2);
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).privacyStatus).toBe("unlisted");
    expect((await item(video.id))).toMatchObject({ class: "APPROVED", awaitingDecision: false });
  }, T);

  it("REVOKE and DECLINE take an approved video off the public site (page and listing) without touching YouTube", async () => {
    for (const kind of ["REVOKE", "DECLINE"] as const) {
      const video = await newVideo();
      const page = await newPage(video.id);
      await runUnlistedReviewSweep();
      const fp = await fingerprintOf(video.id);
      await decideReview({ videoId: video.id, expectedFingerprint: fp, decision: { kind: "APPROVE", scopes: ["PAGE", "DISCOVERY"] }, actorId: users.admin });
      expect(await findPublishedBySlug(page.slug)).not.toBeNull();
      await decideReview({ videoId: video.id, expectedFingerprint: fp, decision: { kind }, actorId: users.admin, note: "no longer wanted" });
      expect(await findPublishedBySlug(page.slug), kind).toBeNull();
      expect(await isListed(page.id)).toBe(false);
      expect((await listActiveApprovals([page.id])).get(page.id) ?? []).toEqual([]);
      expect((await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).state).toBe("DECLINED");
      expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).privacyStatus).toBe("unlisted");
    }
  }, T);

  it("an approval revoked outside the review (the video page panel) returns the item to the queue as needing a decision", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    await runUnlistedReviewSweep();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin });
    await revokeExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    expect(await item(video.id)).toMatchObject({ class: "NEEDS_DECISION", awaitingDecision: true });
    const result = await runUnlistedReviewSweep();
    expect(result.resurfaced).toBeGreaterThanOrEqual(1);
    expect(await item(video.id)).toMatchObject({ class: "PENDING", awaitingDecision: true });
  }, T);
});

describe("approving specific playlist pages", () => {
  it("a review decision can approve the page AND chosen playlist pages together, atomically", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    const playlist = await createPlaylistPage({ title: `Review playlist ${TAG}`, actorId: users.admin });
    playlistIds.push(playlist.id);
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: page.id, actorId: users.admin });
    const bystander = await createPlaylistPage({ title: `Other playlist ${TAG}`, actorId: users.admin });
    playlistIds.push(bystander.id);
    await addPlaylistMember({ playlistPageId: bystander.id, videoPageId: page.id, actorId: users.admin });
    await runUnlistedReviewSweep();

    const queued = await item(video.id);
    expect(queued!.playlists.map((p) => [p.title, p.approved]).sort()).toEqual([[`Other playlist ${TAG}`, false], [`Review playlist ${TAG}`, false]]);

    await decideReview({ videoId: video.id, expectedFingerprint: queued!.fingerprint, decision: { kind: "APPROVE", scopes: ["PAGE"], playlistPageIds: [playlist.id] }, actorId: users.admin });
    const active = (await listActiveApprovals([page.id])).get(page.id)!;
    expect(active).toEqual(expect.arrayContaining([{ scope: "PAGE", playlistPageId: null }, { scope: "PLAYLIST", playlistPageId: playlist.id }]));
    expect(active.some((a) => a.playlistPageId === bystander.id)).toBe(false); // only the chosen playlist
    expect((await item(video.id))!.playlists.find((p) => p.id === playlist.id)!.approved).toBe(true);
    expect(await isListed(page.id)).toBe(false); // a playlist approval never lists the video anywhere else
    const decision = await prisma.videoExposureReviewDecision.findFirstOrThrow({ where: { review: { youtubeVideoId: video.id } } });
    expect(decision.scopes).toEqual(["PAGE", `PLAYLIST:${playlist.id}`]);
  }, T);

  it("a playlist the video is not a member of refuses the WHOLE decision: nothing is approved, nothing is recorded", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    const stranger = await createPlaylistPage({ title: `Stranger playlist ${TAG}`, actorId: users.admin });
    playlistIds.push(stranger.id);
    await runUnlistedReviewSweep();
    const fp = await fingerprintOf(video.id);
    await expect(decideReview({ videoId: video.id, expectedFingerprint: fp, decision: { kind: "APPROVE", scopes: ["PAGE"], playlistPageIds: [stranger.id] }, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    expect((await listActiveApprovals([page.id])).get(page.id) ?? []).toEqual([]);
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect(await prisma.videoExposureReviewDecision.count({ where: { review: { youtubeVideoId: video.id } } })).toBe(0);
    expect((await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).state).toBe("PENDING");
  }, T);

  it("the approved playlist then shows the video publicly on that playlist only", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    const playlist = await createPlaylistPage({ title: `Visible playlist ${TAG}`, actorId: users.admin });
    playlistIds.push(playlist.id);
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: page.id, actorId: users.admin });
    const fresh = await prisma.playlistPage.findUniqueOrThrow({ where: { id: playlist.id } });
    await updatePlaylistDraft({ id: playlist.id, expectedVersion: fresh.version, actorId: users.admin, fields: { title: fresh.title, summary: "A short account of this playlist.", seoDescription: "Watch this playlist of recordings." } });
    await runUnlistedReviewSweep();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE"], playlistPageIds: [playlist.id] }, actorId: users.admin });
    await setSetting("playlistQuality.minEligibleVideos", 1);
    await setSetting("playlistQuality.minContextInputs", 0);
    try {
      await publishPlaylistPage({ id: playlist.id, expectedVersion: (await prisma.playlistPage.findUniqueOrThrow({ where: { id: playlist.id } })).version, actorId: users.admin });
    } finally {
      await clearSetting("playlistQuality.minEligibleVideos");
      await clearSetting("playlistQuality.minContextInputs");
    }
    const live = await findPublishedPlaylistBySlug(playlist.slug);
    expect(live!.members.map((m) => m.page.id)).toEqual([page.id]);
    expect(await isListed(page.id)).toBe(false);
  }, T);
});

describe("holds (rights, copyright, privacy)", () => {
  it("a hold removes the page from public view at once, blocks approval, and keeps the declined item from resurfacing when it changes", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    await runUnlistedReviewSweep();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE", "DISCOVERY"] }, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).not.toBeNull();

    await setReviewHold({ videoId: video.id, hold: "RIGHTS", note: "Rights holder has not agreed.", actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect((await item(video.id))).toMatchObject({ class: "DECLINED", holdReason: "RIGHTS", awaitingDecision: false });
    await expect(approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalBlockedByHoldError);
    await expect(decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalBlockedByHoldError);

    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { title: "Retitled while on hold" } });
    await runUnlistedReviewSweep();
    expect((await item(video.id))).toMatchObject({ class: "DECLINED", awaitingDecision: false }); // a hold is not re-asked about
    expect(await prisma.auditLogEntry.count({ where: { entityId: video.id, action: "VIDEO_REVIEW_HOLD_SET" } })).toBe(1);

    await clearReviewHold({ videoId: video.id, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toBeNull(); // clearing a hold approves nothing
    expect((await item(video.id))).toMatchObject({ class: "PENDING", awaitingDecision: true, holdReason: null });
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).not.toBeNull();
  }, T);

  it("clearing a hold that does not exist is refused", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    await expect(clearReviewHold({ videoId: video.id, actorId: users.admin })).rejects.toThrow(/no hold/i);
  }, T);
});

describe("settings", () => {
  it("switching the review off stops the refresh and resolves the reminder; the cadence is validated", async () => {
    await newVideo();
    await runUnlistedReviewSweep();
    expect((await openReminder())!.status).toBe("OPEN");
    await updateSiteSetting({ key: "unlistedReview.enabled", value: false, expectedVersion: 0, actorId: users.admin });
    try {
      const off = await runUnlistedReviewSweep();
      expect(off).toMatchObject({ enabled: false, notification: "RESOLVED" });
      const created = await newVideo();
      await runUnlistedReviewSweep();
      expect(await prisma.videoExposureReview.findUnique({ where: { youtubeVideoId: created.id } })).toBeNull(); // not refreshed while off
    } finally {
      await resetSiteSetting({ key: "unlistedReview.enabled", expectedVersion: 1, actorId: users.admin });
    }
    expect((await runUnlistedReviewSweep()).enabled).toBe(true);

    await expect(updateSiteSetting({ key: "unlistedReview.cadenceDays", value: 0, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "unlistedReview.cadenceDays", value: 91, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
    await expect(updateSiteSetting({ key: "unlistedReview.cadenceDays", value: 7.5, expectedVersion: 0, actorId: users.admin })).rejects.toThrow();
  }, T);

  it("a longer cadence changes when the reminder returns", async () => {
    await updateSiteSetting({ key: "unlistedReview.cadenceDays", value: 60, expectedVersion: 0, actorId: users.admin });
    try {
      const first = new Date(Date.now() + 8 * DAY); // absorbs any deferral that has fallen due by then
      await runUnlistedReviewSweep(first);
      const second = new Date(first.getTime() + 14 * DAY);
      const sameWindow = Math.floor(first.getTime() / (60 * DAY)) === Math.floor(second.getTime() / (60 * DAY));
      // at the default 7-day cadence a 14-day step is always a new window; at 60 days it usually is not
      expect((await runUnlistedReviewSweep(second)).notification).toBe(sameWindow ? "UNCHANGED" : "RAISED");
    } finally {
      await resetSiteSetting({ key: "unlistedReview.cadenceDays", expectedVersion: 1, actorId: users.admin });
    }
  }, T);
});
describe("authorization of the Studio actions", () => {
  function form(entries: Record<string, string>) {
    const data = new FormData();
    for (const [k, v] of Object.entries(entries)) data.set(k, v);
    return data;
  }

  it("an editor (CATALOGUE_WRITE without RECORDING_PUBLISH) cannot decide; nothing is recorded", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    await runUnlistedReviewSweep();
    const fp = await fingerprintOf(video.id);
    as("editor");
    const message = await redirectOf(() => decideReviewAction(form({ videoId: video.id, fingerprint: fp, decision: "APPROVE_PAGE" })));
    expect(message).toMatch(/permission/i);
    expect(await prisma.videoExposureReviewDecision.count({ where: { review: { youtubeVideoId: video.id } } })).toBe(0);
    expect((await listActiveApprovals([page.id])).size).toBe(0);
  }, T);

  it("an unauthenticated caller cannot decide", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    mockGetCurrentStudioSession.mockResolvedValue(null);
    expect(await redirectOf(() => decideReviewAction(form({ videoId: video.id, fingerprint: "x", decision: "DECLINE" })))).toMatch(/permission/i);
  }, T);

  it("an administrator's decision is recorded under their identity and reports success; a stale one is refused with a message", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    as("admin");
    const fp = await fingerprintOf(video.id);
    expect(await redirectOf(() => decideReviewAction(form({ videoId: video.id, fingerprint: fp, decision: "REQUEST_INFO", note: "Which venue?" })))).toMatch(/recorded/i);
    const [decision] = await prisma.videoExposureReviewDecision.findMany({ where: { review: { youtubeVideoId: video.id } } });
    expect(decision).toMatchObject({ kind: "REQUEST_INFO", actorId: users.admin });

    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { title: "Edited" } });
    expect(await redirectOf(() => decideReviewAction(form({ videoId: video.id, fingerprint: fp, decision: "DECLINE" })))).toMatch(/changed since you opened/i);
  }, T);
});

describe("F1 — deferring or asking for information withdraws an existing approval", () => {
  async function approvedEverywhere() {
    const video = await newVideo();
    const page = await newPage(video.id);
    const playlist = await createPlaylistPage({ title: `F1 playlist ${TAG} ${++counter}`, actorId: users.admin });
    playlistIds.push(playlist.id);
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: page.id, actorId: users.admin });
    await runUnlistedReviewSweep();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE", "DISCOVERY"], playlistPageIds: [playlist.id] }, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).not.toBeNull();
    expect(await isListed(page.id)).toBe(true);
    expect((await listActiveApprovals([page.id])).get(page.id)).toHaveLength(3);
    return { video, page, playlist };
  }

  it.each([
    ["DEFER", { kind: "DEFER" as const, until: new Date(Date.now() + 3 * DAY) }, "DEFERRED"],
    ["REQUEST_INFO", { kind: "REQUEST_INFO" as const, infoRequest: "Who owns the rights?" }, "INFO_REQUESTED"],
  ])("%s revokes the page, listing and playlist approvals, on every public surface, and says so in the audit", async (_name, decision, expectedState) => {
    const { video, page } = await approvedEverywhere();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision, actorId: users.admin });
    expect((await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).state).toBe(expectedState);
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect(await isListed(page.id)).toBe(false);
    expect((await listActiveApprovals([page.id])).get(page.id) ?? []).toEqual([]);
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).unlistedPublicationApprovedAt).toBeNull();
    const history = await prisma.videoExposureApproval.findMany({ where: { videoPageId: page.id } });
    expect(history).toHaveLength(3); // nothing deleted
    expect(history.every((h) => h.revokedAt !== null && h.revokedById === users.admin)).toBe(true);
    const decided = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityId: video.id, action: "VIDEO_REVIEW_DECIDED" }, orderBy: { timestamp: "desc" } });
    expect(decided.afterSnapshot).toMatchObject({ decision: _name, revokedApprovals: 3 });
    expect(await prisma.auditLogEntry.count({ where: { entityId: page.id, action: "VIDEO_EXPOSURE_REVOKED" } })).toBeGreaterThanOrEqual(1);
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).privacyStatus).toBe("unlisted"); // YouTube untouched
  }, T);

  it("nothing comes back by itself: when the deferral falls due the item is awaiting again, still hidden, and only an explicit approval restores it", async () => {
    const { video, page } = await approvedEverywhere();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "DEFER", until: new Date(Date.now() + 2 * DAY) }, actorId: users.admin });
    const due = new Date(Date.now() + 3 * DAY);
    await runUnlistedReviewSweep(due);
    expect(await item(video.id, due)).toMatchObject({ class: "PENDING", awaitingDecision: true, activeScopes: [] });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: false }); // page only: the earlier listing and playlist approvals are NOT restored
    expect(await isListed(page.id)).toBe(false);
  }, T);

  it("deferring a video that was never approved changes nothing public and revokes nothing", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    await runUnlistedReviewSweep();
    await decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "DEFER", until: new Date(Date.now() + DAY) }, actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    const decided = await prisma.auditLogEntry.findFirstOrThrow({ where: { entityId: video.id, action: "VIDEO_REVIEW_DECIDED" } });
    expect(decided.afterSnapshot).toMatchObject({ revokedApprovals: 0 });
    expect(await prisma.auditLogEntry.count({ where: { entityId: page.id, action: "VIDEO_EXPOSURE_REVOKED" } })).toBe(0);
  }, T);

  it("a video with no Music Madras page can still be deferred", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    await expect(decideReview({ videoId: video.id, expectedFingerprint: await fingerprintOf(video.id), decision: { kind: "REQUEST_INFO", infoRequest: "Which choir?" }, actorId: users.admin })).resolves.toMatchObject({ state: "INFO_REQUESTED" });
  }, T);
});

describe("F9 — concurrent review writers are safe and idempotent", () => {
  it("four sweeps at once over new unlisted videos never fail, create exactly one review per video and keep one notification", async () => {
    const made = [];
    for (let i = 0; i < 6; i++) made.push(await newVideo());
    const results = await Promise.allSettled([runUnlistedReviewSweep(), runUnlistedReviewSweep(), runUnlistedReviewSweep(), runUnlistedReviewSweep()]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled", "fulfilled", "fulfilled"]);
    for (const v of made) expect(await prisma.videoExposureReview.count({ where: { youtubeVideoId: v.id } })).toBe(1);
    const totalCreated = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.created : 0), 0);
    expect(totalCreated).toBeGreaterThanOrEqual(6); // each creation is counted once, by the sweep that actually made the row
    expect(await prisma.studioNotification.count({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } })).toBe(1);
    expect((await runUnlistedReviewSweep()).created).toBe(0);
  }, T);

  it("a sweep never overwrites a decision that landed after it read the row", async () => {
    const video = await newVideo();
    const page = await newPage(video.id);
    await runUnlistedReviewSweep();
    // a stale, declined review whose facts have since changed: the sweep wants to resurface it (CHANGED → PENDING)
    await prisma.videoExposureReview.update({ where: { youtubeVideoId: video.id }, data: { state: "DECLINED", proposalFingerprint: "an-older-fingerprint" } });
    const current = await fingerprintOf(video.id);
    const result = await runUnlistedReviewSweep(new Date(), {
      afterRead: async () => {
        // the reviewer decides in the gap between the sweep's read and its write
        await decideReview({ videoId: video.id, expectedFingerprint: current, decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin });
      },
    });
    expect(result.resurfaced).toBe(0);
    expect((await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).state).toBe("APPROVED"); // the decision survived
    expect(await findPublishedBySlug(page.slug)).not.toBeNull();
  }, T);

  it("two decisions racing on a video with no review row both succeed against the single row and both are recorded", async () => {
    const video = await newVideo();
    await runUnlistedReviewSweep();
    await prisma.videoExposureReview.delete({ where: { youtubeVideoId: video.id } }); // the row does not exist when the decisions start
    const fp = (await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } }));
    void fp;
    const expectedFingerprint = (await loadReviewQueue()).find((i) => i.videoId === video.id)!.fingerprint;
    const outcomes = await Promise.allSettled([
      decideReview({ videoId: video.id, expectedFingerprint, decision: { kind: "DECLINE" }, actorId: users.admin }),
      decideReview({ videoId: video.id, expectedFingerprint, decision: { kind: "REQUEST_INFO", infoRequest: "Which choir?" }, actorId: users.editor }),
    ]);
    expect(outcomes.map((o) => o.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(await prisma.videoExposureReview.count({ where: { youtubeVideoId: video.id } })).toBe(1);
    expect(await prisma.videoExposureReviewDecision.count({ where: { review: { youtubeVideoId: video.id } } })).toBe(2);
  }, T);

  it("a hold and a sweep racing on a new video leave one review row carrying the hold", async () => {
    const video = await newVideo();
    await Promise.all([runUnlistedReviewSweep(), setReviewHold({ videoId: video.id, hold: "RIGHTS", actorId: users.admin }), runUnlistedReviewSweep()]);
    const rows = await prisma.videoExposureReview.findMany({ where: { youtubeVideoId: video.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].holdReason).toBe("RIGHTS");
  }, T);
});