import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import { approveExposure, listActiveApprovals, revokeExposure } from "../../modules/db/repositories/videoExposureRepository";
import { archiveVideoPage, createDraftVideoPage, findPublishedBySlug, publishVideoPage, unarchiveVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { setYouTubeVideoObservability, updateYouTubeVideoFields } from "../../modules/db/repositories/youtubeVideoRepository";
import { addPlaylistMember, createPlaylistPage } from "../../modules/db/repositories/playlistPageRepository";
import { findLifecycleViolations, loadApprovalLifecycleStatus, runLifecycleInvariantSweep } from "../../modules/db/repositories/videoLifecycleRepository";
import { acknowledgeMetadataChange, listPendingMetadataReviews, loadMetadataReviewState, observeMetadataIn, runMetadataReviewSweep } from "../../modules/db/repositories/videoMetadataReviewRepository";
import { buildYouTubeSyncRepository } from "../../modules/db/repositories/youtubeSyncRepository";
import { exposedVideoPageWhere } from "../../modules/mmke/catalogue/videoExposureQuery";
import { ApprovalPageArchivedError } from "../../modules/mmke/catalogue/videoExposureErrors";
import { runYouTubeSync } from "../../modules/youtube/sync-engine/syncYouTubeChannel";
import type { YouTubeDataAdapter, YouTubePageResult, YouTubePlaylistItemRecord, YouTubePlaylistRecord, YouTubeVideoRecord } from "../../modules/youtube/adapter";
import type { ExposureSurface } from "../../modules/mmke/catalogue/videoExposure";

// Phase 6K lifecycle hardening, F11 + F12 — the approval lifecycle and metadata re-review, against the isolated test database, through the real write
// boundary (updateYouTubeVideoFields / setYouTubeVideoObservability / archiveVideoPage) and the real sync engine with a fake YouTube adapter.
//
// Policy under test: an unlisted video that STAYS unlisted keeps its approval; one that becomes PRIVATE, or whose page is ARCHIVED, loses every
// approval and needs a FRESH one; uncertainty (not observed, an incomplete sync) never revokes; material metadata changes are recorded as a pending
// review while the page stays public; nothing here touches production.

const TAG = randomUUID().slice(0, 8);
const T = 90000;
const users = {} as Record<"admin", string>;
const videoIds: string[] = [];
const pageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;
const ytId = (prefix: string, n: number) => `${prefix}${TAG.slice(0, 5)}${String(n).padStart(5, "0")}`; // 11 characters, unique per counter value

async function newVideo(privacy: string, over: Record<string, unknown> = {}) {
  const video = await prisma.youTubeVideo.create({
    data: { youtubeVideoId: ytId("l", ++counter), title: `Lifecycle ${counter}`, description: "Original description.", thumbnailUrl: "https://img.example.test/vi/orig.jpg", durationSeconds: 600, privacyStatus: privacy, observabilityState: "OBSERVED", embeddable: true, channelId: "UC-test", publishedAt: new Date("2024-01-01T00:00:00Z"), ...over },
  });
  videoIds.push(video.id);
  return video;
}
async function newPublishedPage(privacy = "unlisted") {
  const video = await newVideo(privacy);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return { video, page };
}
/** An approved, listed unlisted video (PAGE + DISCOVERY), optionally a member of a playlist page approved for it. */
async function newApproved(withPlaylist = false) {
  const { video, page } = await newPublishedPage("unlisted");
  await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
  await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
  let playlistId: string | null = null;
  if (withPlaylist) {
    const playlist = await createPlaylistPage({ title: `Lifecycle playlist ${TAG} ${++counter}`, actorId: users.admin });
    playlistIds.push(playlist.id);
    await addPlaylistMember({ playlistPageId: playlist.id, videoPageId: page.id, actorId: users.admin });
    await approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: playlist.id, actorId: users.admin });
    playlistId = playlist.id;
  }
  return { video, page, playlistId };
}
const exposed = async (pageId: string, surface: ExposureSurface) => (await prisma.youTubeVideoPage.count({ where: { AND: [{ id: pageId }, exposedVideoPageWhere(surface)] } })) === 1;
const activeOf = async (pageId: string) => (await listActiveApprovals([pageId])).get(pageId) ?? [];
const history = (pageId: string) => prisma.videoExposureApproval.findMany({ where: { videoPageId: pageId }, orderBy: [{ approvedAt: "asc" }, { id: "asc" }] });
const audits = (pageId: string, action: string) => prisma.auditLogEntry.findMany({ where: { entityId: pageId, action } });
const flag = async (pageId: string) => (await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: pageId } })).unlistedPublicationApprovedAt;

beforeAll(async () => {
  users.admin = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kl-admin-${TAG}@musicmadras.test`, name: "Lifecycle admin", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
}, T);

afterAll(async () => {
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds] } }, { actorId: users.admin }] } });
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: "metadata-review-pending" } });
  await prisma.fieldOwnership.deleteMany({ where: { resourceId: { in: videoIds } } });
  await prisma.observabilityTransition.deleteMany({ where: { resourceId: { in: videoIds } } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: users.admin } });
}, T);

describe("an approval is kept while the video stays unlisted", () => {
  it("title, description, thumbnail, statistics and a repeated 'unlisted' write never revoke anything", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { title: "A new title", description: "A new description.", thumbnailUrl: "https://img.example.test/vi/new.jpg", currentViewCount: 12345, etag: "e2", privacyStatus: "unlisted" });
    await updateYouTubeVideoFields(video.id, { privacyStatus: "unlisted" });
    expect((await activeOf(page.id)).map((a) => a.scope).sort()).toEqual(["DISCOVERY", "PAGE"]);
    expect(await flag(page.id)).not.toBeNull();
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
    expect(await exposed(page.id, { kind: "DISCOVERY" })).toBe(true);
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("APPROVED_METADATA_REVIEW_PENDING"); // the title changed: pending review, still approved
    expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(0);
  }, T);

  it("a video that goes public and later returns to unlisted is not a lifecycle revocation either (no rule says otherwise)", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { privacyStatus: "public" });
    await updateYouTubeVideoFields(video.id, { privacyStatus: "unlisted" });
    expect(await activeOf(page.id)).toHaveLength(2);
  }, T);
});

describe("a video that becomes private loses every approval, and a fresh approval is needed", () => {
  it("revokes PAGE, listing and playlist approvals in the same write, clears the flag, records why, and hides the video everywhere", async () => {
    const { video, page, playlistId } = await newApproved(true);
    expect(await activeOf(page.id)).toHaveLength(3);
    await updateYouTubeVideoFields(video.id, { privacyStatus: "private" });

    expect(await activeOf(page.id)).toHaveLength(0);
    expect(await flag(page.id)).toBeNull();
    const rows = await history(page.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatchObject({ revokedReason: "VIDEO_PRIVATE", revokedById: null });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    for (const surface of [{ kind: "PAGE" }, { kind: "DISCOVERY" }, { kind: "PLAYLIST", playlistPageId: playlistId! }] as const) expect(await exposed(page.id, surface), surface.kind).toBe(false);
    expect(await findPublishedBySlug(page.slug)).toBeNull();

    const [entry] = await audits(page.id, "VIDEO_EXPOSURE_REVOKED");
    expect(entry).toBeDefined();
    expect(entry.actorId).toBeNull(); // the platform, not a person
    expect(entry.afterSnapshot).toMatchObject({ revoked: 3, reason: "VIDEO_PRIVATE" });
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("REVOKED_BY_LIFECYCLE");
  }, T);

  it("returning to unlisted does NOT bring the approval back: the page stays hidden, Studio says a fresh approval is awaited, and an explicit approval restores it", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { privacyStatus: "private" });
    await updateYouTubeVideoFields(video.id, { privacyStatus: "unlisted" });

    expect(await activeOf(page.id)).toHaveLength(0);
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(false);
    expect(await exposed(page.id, { kind: "DISCOVERY" })).toBe(false);
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("AWAITING_FRESH_APPROVAL");

    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
    expect(await exposed(page.id, { kind: "DISCOVERY" })).toBe(false); // listing is its own approval, and was not restored either
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("APPROVED");
    const rows = await history(page.id);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1); // one NEW row; the old ones stay as history
    expect(rows.filter((r) => r.revokedReason === "VIDEO_PRIVATE")).toHaveLength(2);
  }, T);

  it("is idempotent: the same transition applied again records nothing more", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { privacyStatus: "private" });
    await updateYouTubeVideoFields(video.id, { privacyStatus: "private", title: "Renamed while private" });
    await setYouTubeVideoObservability(video.id, "OBSERVED");
    expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(1);
    expect((await history(page.id)).filter((r) => r.revokedAt !== null)).toHaveLength(2);
  }, T);

  it("a PRIVATE observability state ends the approval the same way (reason VIDEO_PRIVATE)", async () => {
    const { video, page } = await newApproved();
    await setYouTubeVideoObservability(video.id, "PRIVATE");
    expect(await activeOf(page.id)).toHaveLength(0);
    expect((await history(page.id)).every((r) => r.revokedReason === "VIDEO_PRIVATE")).toBe(true);
  }, T);

  it("a video that was never approved is untouched (nothing to revoke, no audit noise)", async () => {
    const { video, page } = await newPublishedPage("unlisted");
    await updateYouTubeVideoFields(video.id, { privacyStatus: "private" });
    expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(0);
    expect(await history(page.id)).toHaveLength(0);
  }, T);
});

describe("uncertainty is not a transition: not observed never revokes", () => {
  it("NOT_OBSERVED hides the video (the exposure rule) but keeps the approval; observed again, it is exposed with no new approval", async () => {
    const { video, page } = await newApproved();
    const before = (await activeOf(page.id)).length;
    const ids = (await history(page.id)).map((r) => r.id);
    await setYouTubeVideoObservability(video.id, "NOT_OBSERVED");
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(false);
    expect((await activeOf(page.id)).length).toBe(before);
    expect(await flag(page.id)).not.toBeNull();
    await setYouTubeVideoObservability(video.id, "SYNC_ERROR");
    expect((await activeOf(page.id)).length).toBe(before);
    await setYouTubeVideoObservability(video.id, "OBSERVED");
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
    expect(await exposed(page.id, { kind: "DISCOVERY" })).toBe(true);
    expect((await history(page.id)).map((r) => r.id)).toEqual(ids); // the very same approval rows
    expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(0);
  }, T);
});

describe("unavailable and deleted are NOT revocation reasons (owner decision): hidden while unavailable, approvals and history untouched", () => {
  for (const state of ["UNAVAILABLE", "DELETED"] as const) {
    it(`${state}: every surface hides the video, no approval is revoked, no audit is written, the flag stays, and Studio still says approved`, async () => {
      const { video, page, playlistId } = await newApproved(true);
      const rowsBefore = (await history(page.id)).map((r) => ({ id: r.id, revokedAt: r.revokedAt, revokedReason: r.revokedReason }));
      await setYouTubeVideoObservability(video.id, state);

      for (const surface of [{ kind: "PAGE" }, { kind: "DISCOVERY" }, { kind: "PLAYLIST", playlistPageId: playlistId! }] as const) expect(await exposed(page.id, surface), `${state} ${surface.kind}`).toBe(false);
      expect(await findPublishedBySlug(page.slug)).toBeNull();
      expect(await activeOf(page.id)).toHaveLength(3);
      expect(await flag(page.id)).not.toBeNull();
      expect((await history(page.id)).map((r) => ({ id: r.id, revokedAt: r.revokedAt, revokedReason: r.revokedReason }))).toEqual(rowsBefore);
      expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(0);
      expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("APPROVED");
      expect((await findLifecycleViolations()).map((v) => v.id)).not.toContain(page.id);
    }, T);

    it(`${state}: the invariant sweep leaves the approvals alone, and the video is exposed again the moment it is observed, with the very same approvals`, async () => {
      const { video, page } = await newApproved();
      const ids = (await history(page.id)).map((r) => r.id);
      await setYouTubeVideoObservability(video.id, state);
      const sweep = await runLifecycleInvariantSweep();
      expect(sweep.failed).toBe(0);
      expect(await activeOf(page.id)).toHaveLength(2);
      await setYouTubeVideoObservability(video.id, "OBSERVED");
      expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
      expect(await exposed(page.id, { kind: "DISCOVERY" })).toBe(true);
      expect((await history(page.id)).map((r) => r.id)).toEqual(ids);
      expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(0);
    }, T);
  }

  it("a PUBLIC video that is unavailable or deleted is hidden too, and comes back with availability", async () => {
    const { video, page } = await newPublishedPage("public");
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
    for (const state of ["UNAVAILABLE", "DELETED"] as const) {
      await setYouTubeVideoObservability(video.id, state);
      expect(await exposed(page.id, { kind: "PAGE" }), state).toBe(false);
      expect(await exposed(page.id, { kind: "DISCOVERY" }), state).toBe(false);
    }
    await setYouTubeVideoObservability(video.id, "OBSERVED");
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
  }, T);

  it("restoring availability does not bypass privacy, archive, a hold or a withdrawn approval: each is still enforced on its own", async () => {
    // Unavailable, and meanwhile it becomes private: private revokes (an authorised revocation), and availability returning does not bring the approval back.
    const priv = await newApproved();
    await setYouTubeVideoObservability(priv.video.id, "UNAVAILABLE");
    await updateYouTubeVideoFields(priv.video.id, { privacyStatus: "private" });
    expect(await activeOf(priv.page.id)).toHaveLength(0);
    await setYouTubeVideoObservability(priv.video.id, "OBSERVED");
    await updateYouTubeVideoFields(priv.video.id, { privacyStatus: "unlisted" });
    expect(await exposed(priv.page.id, { kind: "PAGE" })).toBe(false);
    expect((await loadApprovalLifecycleStatus(priv.page.id))!.status).toBe("AWAITING_FRESH_APPROVAL");

    // Unavailable, and the page is archived meanwhile: archive revokes; availability returning and a restore do not bring the approval back.
    const arch = await newApproved();
    await setYouTubeVideoObservability(arch.video.id, "DELETED");
    await archiveVideoPage(arch.page.id, users.admin);
    expect(await activeOf(arch.page.id)).toHaveLength(0);
    await setYouTubeVideoObservability(arch.video.id, "OBSERVED");
    await unarchiveVideoPage(arch.page.id, users.admin);
    expect(await exposed(arch.page.id, { kind: "PAGE" })).toBe(false);

    // Unavailable, and an editor withdraws the approval meanwhile: availability returning does not recreate it.
    const withdrawn = await newApproved();
    await setYouTubeVideoObservability(withdrawn.video.id, "UNAVAILABLE");
    await revokeExposure({ videoPageId: withdrawn.page.id, scope: "PAGE", actorId: users.admin });
    await setYouTubeVideoObservability(withdrawn.video.id, "OBSERVED");
    expect(await exposed(withdrawn.page.id, { kind: "PAGE" })).toBe(false);

    // Unavailable, and a rights hold is recorded meanwhile: the hold still denies every surface once the video is available again.
    const held = await newApproved();
    await setYouTubeVideoObservability(held.video.id, "UNAVAILABLE");
    // Written directly (setReviewHold would also revoke the approvals, and this case is about the hold being enforced on its own).
    await prisma.videoExposureReview.upsert({
      where: { youtubeVideoId: held.video.id },
      create: { youtubeVideoId: held.video.id, state: "DECLINED", proposalFingerprint: "hold-test", holdReason: "RIGHTS", holdNote: "Rights under review." },
      update: { holdReason: "RIGHTS", holdNote: "Rights under review." },
    });
    expect(await activeOf(held.page.id)).toHaveLength(2); // the approvals are still there; only the hold stops exposure
    await setYouTubeVideoObservability(held.video.id, "OBSERVED");
    expect(await exposed(held.page.id, { kind: "PAGE" })).toBe(false);
    expect(await exposed(held.page.id, { kind: "DISCOVERY" })).toBe(false);
  }, T);
});

describe("an archived page loses its approvals; restoring it does not bring them back", () => {
  it("archive, approvals ended and audit written in one transaction; restore leaves the page hidden until a fresh approval", async () => {
    const { page } = await newApproved(true);
    await archiveVideoPage(page.id, users.admin);

    expect(await activeOf(page.id)).toHaveLength(0);
    expect(await flag(page.id)).toBeNull();
    const rows = await history(page.id);
    expect(rows.every((r) => r.revokedReason === "PAGE_ARCHIVED" && r.revokedById === users.admin)).toBe(true);
    expect(await audits(page.id, "VIDEO_PAGE_ARCHIVED")).toHaveLength(1);
    expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(1);
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("REVOKED_BY_LIFECYCLE");

    await unarchiveVideoPage(page.id, users.admin);
    expect(await activeOf(page.id)).toHaveLength(0);
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(false);
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("AWAITING_FRESH_APPROVAL");
    expect((await audits(page.id, "VIDEO_PAGE_UNARCHIVED"))[0].afterSnapshot).toMatchObject({ note: expect.stringMatching(/does not restore any approval/) });

    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
  }, T);

  it("an archived page cannot be approved at all (restore it first), so an approval can never be made to survive archiving", async () => {
    const { page } = await newPublishedPage("unlisted");
    await archiveVideoPage(page.id, users.admin);
    await expect(approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalPageArchivedError);
    expect(await history(page.id)).toHaveLength(0);
  }, T);

  it("archiving twice, or restoring a page that is not archived, changes nothing", async () => {
    const { page } = await newApproved();
    await archiveVideoPage(page.id, users.admin);
    await archiveVideoPage(page.id, users.admin);
    expect(await audits(page.id, "VIDEO_PAGE_ARCHIVED")).toHaveLength(1);
    await unarchiveVideoPage(page.id, users.admin);
    await unarchiveVideoPage(page.id, users.admin);
    expect(await audits(page.id, "VIDEO_PAGE_UNARCHIVED")).toHaveLength(1);
  }, T);

  it("unpublishing is the editor's own act and is NOT an archive: the approval stands", async () => {
    const { page } = await newApproved();
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { status: "DRAFT" } });
    expect(await activeOf(page.id)).toHaveLength(2);
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { status: "PUBLISHED" } });
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
  }, T);
});

describe("the invariant sweep repairs approvals that survived a writer which bypassed the boundary", () => {
  it("finds an approval on a private video or archived page and revokes it, so a later return to unlisted/restore cannot resurrect it", async () => {
    const a = await newApproved();
    const b = await newApproved();
    // Writers that bypass the boundary: straight SQL through the ORM, as an old release or an operator might.
    await prisma.youTubeVideo.update({ where: { id: a.video.id }, data: { privacyStatus: "private" } });
    await prisma.youTubeVideoPage.update({ where: { id: b.page.id }, data: { archivedAt: new Date() } });
    const violations = (await findLifecycleViolations()).map((v) => v.id);
    expect(violations).toEqual(expect.arrayContaining([a.page.id, b.page.id]));

    const result = await runLifecycleInvariantSweep();
    expect(result.failed).toBe(0);
    expect(result.completed).toBe(true);
    expect(result.revoked).toBeGreaterThanOrEqual(4);
    expect(await activeOf(a.page.id)).toHaveLength(0);
    expect(await activeOf(b.page.id)).toHaveLength(0);
    expect((await findLifecycleViolations()).map((v) => v.id)).not.toEqual(expect.arrayContaining([a.page.id]));

    // Now the video returns to unlisted and the page is restored — through writers that bypass the boundary again. Nothing comes back.
    await prisma.youTubeVideo.update({ where: { id: a.video.id }, data: { privacyStatus: "unlisted" } });
    await prisma.youTubeVideoPage.update({ where: { id: b.page.id }, data: { archivedAt: null } });
    expect(await exposed(a.page.id, { kind: "PAGE" })).toBe(false);
    expect(await exposed(b.page.id, { kind: "PAGE" })).toBe(false);
    expect((await history(a.page.id)).map((r) => r.revokedReason)).toEqual(["VIDEO_PRIVATE", "VIDEO_PRIVATE"]);
    expect((await history(b.page.id)).map((r) => r.revokedReason)).toEqual(["PAGE_ARCHIVED", "PAGE_ARCHIVED"]);
  }, T);

  it("works in bounded batches with a stable cursor and reports them, and a second run finds nothing to do", async () => {
    const created = [await newApproved(), await newApproved(), await newApproved()];
    for (const c of created) await prisma.youTubeVideo.update({ where: { id: c.video.id }, data: { privacyStatus: "private" } });
    const first = await runLifecycleInvariantSweep({ batchSize: 2 });
    expect(first.batches).toBeGreaterThanOrEqual(2);
    expect(first.completed).toBe(true);
    for (const c of created) expect(await activeOf(c.page.id)).toHaveLength(0);
    const second = await runLifecycleInvariantSweep({ batchSize: 2 });
    expect(second).toMatchObject({ examined: 0, revoked: 0, failed: 0 });
  }, T);

  it("does not touch uncertainty or healthy pages", async () => {
    const healthy = await newApproved();
    const unobserved = await newApproved();
    await prisma.youTubeVideo.update({ where: { id: unobserved.video.id }, data: { observabilityState: "NOT_OBSERVED" } });
    await runLifecycleInvariantSweep();
    expect(await activeOf(healthy.page.id)).toHaveLength(2);
    expect(await activeOf(unobserved.page.id)).toHaveLength(2);
  }, T);
});

describe("metadata changes after approval: recorded as a pending review while the page stays public", () => {
  it("records a baseline at approval; a title/description/thumbnail change makes ONE pending review naming what changed; the page stays exposed and approved", async () => {
    const { video, page } = await newApproved();
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).metadataReviewedSnapshot).not.toBeNull();
    expect((await loadMetadataReviewState(page.id)).pending).toBeNull();

    await updateYouTubeVideoFields(video.id, { title: "A new title", description: "Changed description.", thumbnailUrl: "https://img.example.test/vi/second.jpg" });
    const { pending } = await loadMetadataReviewState(page.id);
    expect(pending).toMatchObject({ status: "PENDING" });
    expect([...pending!.changedFields].sort()).toEqual(["description", "thumbnail", "title"]);
    expect(Array.isArray(pending!.changeSummary)).toBe(true);
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true); // approved and public meanwhile
    expect(await exposed(page.id, { kind: "DISCOVERY" })).toBe(true);
    expect(await activeOf(page.id)).toHaveLength(2); // the approval is NOT revoked by a metadata change
    expect((await loadApprovalLifecycleStatus(page.id))).toMatchObject({ status: "APPROVED_METADATA_REVIEW_PENDING", changedFields: expect.arrayContaining(["title"]) });
    expect(await audits(page.id, "VIDEO_METADATA_CHANGE_DETECTED")).toHaveLength(1);
    expect((await listPendingMetadataReviews()).map((i) => i.videoPageId)).toContain(page.id);
  }, T);

  it("repeating the same observation changes nothing; a further change updates the same pending review instead of opening another", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { title: "Second title" });
    await updateYouTubeVideoFields(video.id, { title: "Second title" });
    await updateYouTubeVideoFields(video.id, { etag: "other", currentViewCount: 9 });
    expect(await prisma.videoMetadataChange.count({ where: { videoPageId: page.id } })).toBe(1);
    expect(await audits(page.id, "VIDEO_METADATA_CHANGE_DETECTED")).toHaveLength(1);

    await updateYouTubeVideoFields(video.id, { durationSeconds: 480 });
    const rows = await prisma.videoMetadataChange.findMany({ where: { videoPageId: page.id } });
    expect(rows).toHaveLength(1);
    expect([...rows[0].changedFields].sort()).toEqual(["duration", "title"]);
    expect(await audits(page.id, "VIDEO_METADATA_CHANGE_UPDATED")).toHaveLength(1);
    // And a direct re-observation is a no-op.
    expect(await prisma.$transaction((tx) => observeMetadataIn(tx, page.id))).toBe("STILL_PENDING");
  }, T);

  it("changes that are not material (statistics, etag, whitespace, a cache-busting thumbnail query) create no review", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { currentViewCount: 999, currentLikeCount: 9, currentCommentCount: 3, statisticsUpdatedAt: new Date(), etag: "x" });
    await updateYouTubeVideoFields(video.id, { title: `  ${video.title}  `, description: "Original description.  \r\n", thumbnailUrl: "https://img.example.test/vi/orig.jpg?cb=2" });
    expect(await prisma.videoMetadataChange.count({ where: { videoPageId: page.id } })).toBe(0);
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("APPROVED");
  }, T);

  it("duration, published date, embeddability and channel are identity/representation fields: each is a material change", async () => {
    for (const change of [{ durationSeconds: 300 }, { publishedAt: new Date("2023-05-05T00:00:00Z") }, { embeddable: false }, { channelId: "UC-other" }]) {
      const { video, page } = await newApproved();
      await updateYouTubeVideoFields(video.id, change);
      expect((await loadMetadataReviewState(page.id)).pending, JSON.stringify(change)).not.toBeNull();
    }
  }, T);

  it("a change that goes back to what was reviewed resolves the review as reverted", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { title: "Temporary rename" });
    expect((await loadMetadataReviewState(page.id)).pending).not.toBeNull();
    await updateYouTubeVideoFields(video.id, { title: video.title });
    const state = await loadMetadataReviewState(page.id);
    expect(state.pending).toBeNull();
    expect(state.history[0].change.status).toBe("REVERTED");
    expect(await audits(page.id, "VIDEO_METADATA_CHANGE_REVERTED")).toHaveLength(1);
  }, T);

  it("only an editor's acknowledgement marks changed metadata as reviewed: the baseline moves, the review resolves, who is recorded, and a second acknowledgement is a no-op", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { title: "Reviewed title" });
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("APPROVED_METADATA_REVIEW_PENDING"); // not silently treated as reviewed
    expect(await acknowledgeMetadataChange({ videoPageId: page.id, actorId: users.admin, note: "Looks right." })).toEqual({ acknowledged: true });
    const state = await loadMetadataReviewState(page.id);
    expect(state.pending).toBeNull();
    expect(state.history[0]).toMatchObject({ resolvedByName: "Lifecycle admin" });
    expect(state.history[0].change).toMatchObject({ status: "ACKNOWLEDGED", resolutionNote: "Looks right." });
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("APPROVED");
    expect(await acknowledgeMetadataChange({ videoPageId: page.id, actorId: users.admin })).toEqual({ acknowledged: false });
    expect((await audits(page.id, "VIDEO_METADATA_CHANGE_ACKNOWLEDGED"))[0]).toMatchObject({ actorId: users.admin });
    // A new change after the acknowledgement is compared with the NEW baseline.
    await updateYouTubeVideoFields(video.id, { title: "Reviewed title" });
    expect((await loadMetadataReviewState(page.id)).pending).toBeNull();
    await updateYouTubeVideoFields(video.id, { title: "Yet another title" });
    expect((await loadMetadataReviewState(page.id)).pending).not.toBeNull();
  }, T);

  it("there is nothing to acknowledge on a page that holds no approval", async () => {
    const { page } = await newPublishedPage("unlisted");
    await expect(acknowledgeMetadataChange({ videoPageId: page.id, actorId: users.admin })).rejects.toThrow(/no active approval/);
  }, T);

  it("private/archive rules win over a pending review: the review is voided with the approval, and a fresh approval starts from a fresh baseline", async () => {
    const priv = await newApproved();
    await updateYouTubeVideoFields(priv.video.id, { title: "Changed before going private" });
    expect((await loadMetadataReviewState(priv.page.id)).pending).not.toBeNull();
    await updateYouTubeVideoFields(priv.video.id, { privacyStatus: "private" });
    let state = await loadMetadataReviewState(priv.page.id);
    expect(state.pending).toBeNull();
    expect(state.history[0].change.status).toBe("VOIDED");
    expect(await exposed(priv.page.id, { kind: "PAGE" })).toBe(false);
    expect((await loadApprovalLifecycleStatus(priv.page.id))!.status).toBe("REVOKED_BY_LIFECYCLE");
    // Metadata keeps changing while private: nothing is recorded for a page with no approval.
    await updateYouTubeVideoFields(priv.video.id, { title: "Changed while private" });
    expect(await prisma.videoMetadataChange.count({ where: { videoPageId: priv.page.id } })).toBe(1);
    // Back to unlisted, approved afresh: the baseline is what is there NOW, so the earlier changes are not re-raised.
    await updateYouTubeVideoFields(priv.video.id, { privacyStatus: "unlisted" });
    await approveExposure({ videoPageId: priv.page.id, scope: "PAGE", actorId: users.admin });
    expect((await loadMetadataReviewState(priv.page.id)).pending).toBeNull();
    expect((await loadApprovalLifecycleStatus(priv.page.id))!.status).toBe("APPROVED");

    const arch = await newApproved();
    await updateYouTubeVideoFields(arch.video.id, { description: "Changed before archiving" });
    await archiveVideoPage(arch.page.id, users.admin);
    state = await loadMetadataReviewState(arch.page.id);
    expect(state.pending).toBeNull();
    expect(state.history[0].change.status).toBe("VOIDED");
  }, T);

  it("a withdrawn approval voids a pending review too (a person revoked it)", async () => {
    const { video, page } = await newApproved();
    await updateYouTubeVideoFields(video.id, { title: "Changed" });
    await revokeExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    expect((await loadMetadataReviewState(page.id)).history[0].change.status).toBe("VOIDED");
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("NOT_APPROVED"); // an editor's revocation is not a lifecycle revocation
  }, T);

  it("the catch-up sweep records a baseline for an approval that predates metadata tracking (stated as a baseline, never a 'change'), then detects later changes", async () => {
    const { video, page } = await newPublishedPage("unlisted");
    // An approval made before this existed: rows and the flag, no baseline.
    await prisma.videoExposureApproval.create({ data: { videoPageId: page.id, scope: "PAGE", approvedById: null, origin: "MIGRATED_LEGACY", note: "carried over" } });
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { unlistedPublicationApprovedAt: new Date() } });
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).metadataReviewedSnapshot).toBeNull();

    const first = await runMetadataReviewSweep({ batchSize: 2 });
    expect(first.baselinesRecorded).toBeGreaterThanOrEqual(1);
    expect(first.failed).toBe(0);
    expect(await prisma.videoMetadataChange.count({ where: { videoPageId: page.id } })).toBe(0);
    expect((await audits(page.id, "VIDEO_METADATA_BASELINE_RECORDED"))[0].afterSnapshot).toMatchObject({ note: expect.stringMatching(/not a reviewed change/) });

    await updateYouTubeVideoFields(video.id, { description: "Edited after the baseline." });
    expect((await loadMetadataReviewState(page.id)).pending).not.toBeNull();
    const second = await runMetadataReviewSweep();
    expect(second.baselinesRecorded).toBe(0);
  }, T);

  it("the sweep also detects a change written by something that bypassed the boundary, and is repeatable", async () => {
    const { video, page } = await newApproved();
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { title: "Written behind the boundary's back" } });
    expect((await loadMetadataReviewState(page.id)).pending).toBeNull();
    const first = await runMetadataReviewSweep();
    expect(first.detected).toBeGreaterThanOrEqual(1);
    expect((await loadMetadataReviewState(page.id)).pending).not.toBeNull();
    const second = await runMetadataReviewSweep();
    expect(second.detected).toBe(0);
    expect(await prisma.videoMetadataChange.count({ where: { videoPageId: page.id } })).toBe(1);
  }, T);
});

describe("through the real sync engine", () => {
  const CHANNEL = "UC-test-channel";
  const UPLOADS = "UU-test-uploads";
  /** A repository for the real database whose checkpoint writes are skipped, so a test run leaves no global sync state behind. */
  const repository = () => ({ ...buildYouTubeSyncRepository(null), async upsertCheckpoint() {} });
  const NOW = new Date("2026-06-01T00:00:00Z");

  function adapter(videos: YouTubeVideoRecord[], failures: { listVideos?: boolean } = {}): YouTubeDataAdapter {
    return {
      async getChannel() {
        return { channelId: CHANNEL, title: "Test", uploadsPlaylistId: UPLOADS, videoCount: null, etag: '"c"' };
      },
      async listPlaylists(): Promise<YouTubePageResult<YouTubePlaylistRecord>> {
        return { items: [], nextPageToken: null };
      },
      async listPlaylistItems(playlistId: string): Promise<YouTubePageResult<YouTubePlaylistItemRecord>> {
        if (playlistId !== UPLOADS) return { items: [], nextPageToken: null };
        return { items: videos.map((v, position) => ({ playlistId: UPLOADS, videoId: v.videoId, position, title: null, publishedAt: null, etag: `"i${position}"` })), nextPageToken: null };
      },
      async listVideos() {
        if (failures.listVideos) throw new Error("simulated listVideos failure");
        return videos;
      },
    } as unknown as YouTubeDataAdapter;
  }

  /**
   * What YouTube would report for EVERY video in the test database exactly as it is now (so a pass changes nothing it is not meant to), with overrides for
   * particular videos by internal id, and some videos left out entirely (a video YouTube did not return).
   */
  async function everyVideo(options: { override?: Record<string, Partial<YouTubeVideoRecord>>; leaveOut?: string[] } = {}): Promise<YouTubeVideoRecord[]> {
    const rows = await prisma.youTubeVideo.findMany();
    return rows
      .filter((r) => !(options.leaveOut ?? []).includes(r.id))
      .map((r) => ({
        videoId: r.youtubeVideoId,
        title: r.title ?? "",
        description: r.description ?? "",
        thumbnails: r.thumbnailUrl ? { high: { url: r.thumbnailUrl } } : {},
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        durationIso8601: `PT${r.durationSeconds ?? 0}S`,
        channelId: r.channelId ?? "UC-test",
        channelTitle: "Test",
        privacyStatus: r.privacyStatus ?? "public",
        uploadStatus: "processed",
        embeddable: r.embeddable ?? true,
        viewCount: String(r.currentViewCount ?? 0),
        likeCount: String(r.currentLikeCount ?? 0),
        commentCount: String(r.currentCommentCount ?? 0),
        etag: r.etag ?? '"v"',
        ...(options.override?.[r.id] ?? {}),
      })) as unknown as YouTubeVideoRecord[];
  }

  it("an incomplete (partial) sync never revokes anything, even though it could not observe the video", async () => {
    const { video, page } = await newApproved();
    const result = await runYouTubeSync(adapter([], { listVideos: true }), repository(), { channelId: CHANNEL, now: NOW });
    expect(result.completeness).toBe("PARTIAL");
    expect(await activeOf(page.id)).toHaveLength(2);
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).observabilityState).toBe("OBSERVED"); // nothing was flagged
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
  }, T);

  it("a pass that looks complete but is implausible (it lost most of the catalogue) is refused: nothing is flagged and no approval changes", async () => {
    const { video, page } = await newApproved();
    const only = (await everyVideo()).filter((r) => r.videoId !== video.youtubeVideoId).slice(0, 1); // nearly everything is "missing"
    const result = await runYouTubeSync(adapter(only), repository(), { channelId: CHANNEL, now: NOW });
    expect(result.videoAbsenceEvaluated).toBe(false);
    expect(result.completeness).toBe("PARTIAL");
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).observabilityState).toBe("OBSERVED");
    expect(await activeOf(page.id)).toHaveLength(2);
  }, T);

  it("a FULL pass that does not see the video marks it NOT_OBSERVED (uncertainty): approvals stand; a later pass that sees it restores exposure with the same approvals", async () => {
    const { video, page } = await newApproved();
    const ids = (await history(page.id)).map((r) => r.id);
    const absent = await runYouTubeSync(adapter(await everyVideo({ leaveOut: [video.id] })), repository(), { channelId: CHANNEL, now: NOW });
    expect(absent.videoAbsenceEvaluated).toBe(true);
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).observabilityState).toBe("NOT_OBSERVED");
    expect(await activeOf(page.id)).toHaveLength(2);
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(false); // hidden while unobserved

    const back = await runYouTubeSync(adapter(await everyVideo()), repository(), { channelId: CHANNEL, now: NOW });
    expect(back.completeness).toBe("FULL");
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).observabilityState).toBe("OBSERVED");
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
    expect((await history(page.id)).map((r) => r.id)).toEqual(ids);
    expect(await audits(page.id, "VIDEO_EXPOSURE_REVOKED")).toHaveLength(0);
  }, T);

  it("a sync that reports the video as private revokes its approvals through the real write boundary; reporting it unlisted again does not restore them", async () => {
    const { video, page } = await newApproved();
    await runYouTubeSync(adapter(await everyVideo({ override: { [video.id]: { privacyStatus: "private" } } })), repository(), { channelId: CHANNEL, now: NOW });
    expect(await activeOf(page.id)).toHaveLength(0);
    expect((await history(page.id)).every((r) => r.revokedReason === "VIDEO_PRIVATE")).toBe(true);
    await runYouTubeSync(adapter(await everyVideo({ override: { [video.id]: { privacyStatus: "unlisted" } } })), repository(), { channelId: CHANNEL, now: NOW });
    expect(await activeOf(page.id)).toHaveLength(0);
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(false);
    expect((await loadApprovalLifecycleStatus(page.id))!.status).toBe("AWAITING_FRESH_APPROVAL");
  }, T);

  it("a sync that changes the title records ONE pending review; the same sync again records nothing more; the page stays public throughout", async () => {
    const { video, page } = await newApproved();
    await runYouTubeSync(adapter(await everyVideo()), repository(), { channelId: CHANNEL, now: NOW });
    expect((await loadMetadataReviewState(page.id)).pending).toBeNull(); // the same facts: nothing to review
    const changed = await everyVideo({ override: { [video.id]: { title: "Retitled on YouTube" } } });
    await runYouTubeSync(adapter(changed), repository(), { channelId: CHANNEL, now: NOW });
    await runYouTubeSync(adapter(changed), repository(), { channelId: CHANNEL, now: NOW });
    expect(await prisma.videoMetadataChange.count({ where: { videoPageId: page.id } })).toBe(1);
    expect((await loadMetadataReviewState(page.id)).pending!.changedFields).toEqual(["title"]);
    expect(await exposed(page.id, { kind: "PAGE" })).toBe(true);
    expect(await activeOf(page.id)).toHaveLength(2);
  }, T);
});