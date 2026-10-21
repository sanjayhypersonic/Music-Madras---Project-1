import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Must be at the true top level — vi.mock is hoisted above every import.
const mockGetCurrentStudioSession = vi.fn();
vi.mock("../../modules/auth/authService", () => ({ getCurrentStudioSession: () => mockGetCurrentStudioSession() }));

import { prisma } from "../../modules/db/client";
import {
  approveExposure,
  findApprovalFlagInconsistencies,
  listActiveApprovals,
  listApprovalHistory,
  revokeExposure,
} from "../../modules/db/repositories/videoExposureRepository";
import { createDraftVideoPage, findPublishedBySlug, listPublishedVideoPages, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { addPlaylistMember, archivePlaylistPage, createPlaylistPage } from "../../modules/db/repositories/playlistPageRepository";
import {
  ApprovalBlockedByHoldError,
  ApprovalInvalidError,
  ApprovalNotApplicableError,
  ApprovalPrerequisiteError,
  VideoNotAvailableError,
} from "../../modules/mmke/catalogue/videoExposureErrors";
import { approveDiscoveryAction, approveUnlistedPublicationAction, revokeDiscoveryAction } from "../../app/(studio)/studio/(protected)/catalogue/videos/[videoId]/actions";

// Phase 6K-2 — scoped, recorded, revocable exposure approvals against the isolated test database.

const TAG = randomUUID().slice(0, 8);
const T = 60000;
const users = {} as Record<"admin" | "editor", string>;
const roles = { admin: "ADMINISTRATOR", editor: "EDITOR" } as const;
const videoIds: string[] = [];
const pageIds: string[] = [];
const playlistIds: string[] = [];
let counter = 0;

async function newVideo(privacy: string, observability: "OBSERVED" | "NOT_OBSERVED" = "OBSERVED") {
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: `x${TAG}${++counter}`.slice(0, 11), title: `Exposure ${counter}`, privacyStatus: privacy, observabilityState: observability } });
  videoIds.push(video.id);
  return video;
}
async function newPublishedPage(privacy: string, observability: "OBSERVED" | "NOT_OBSERVED" = "OBSERVED") {
  const video = await newVideo(privacy, observability);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return { video, page };
}
async function playlistWith(videoPageId: string | null) {
  const playlist = await createPlaylistPage({ title: `Exposure playlist ${TAG} ${++counter}`, actorId: users.admin });
  playlistIds.push(playlist.id);
  if (videoPageId) await addPlaylistMember({ playlistPageId: playlist.id, videoPageId, actorId: users.admin });
  return playlist;
}
const active = async (pageId: string) => (await listActiveApprovals([pageId])).get(pageId) ?? [];
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

beforeAll(async () => {
  for (const who of Object.keys(roles) as (keyof typeof users)[]) {
    users[who] = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6k2-${who}-${TAG}@musicmadras.test`, name: `Exposure ${who}`, role: roles[who], status: "ACTIVE" } })).id;
  }
}, T);

afterAll(async () => {
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: pageIds } }, { actorId: { in: Object.values(users) } }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.playlistPage.deleteMany({ where: { id: { in: playlistIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: { in: Object.values(users) } } });
}, T);

describe("approving a scope", () => {
  it("records the PAGE approval (who, when), keeps the legacy flag in step, and audits it — without touching YouTube", async () => {
    const { page, video } = await newPublishedPage("unlisted");
    const result = await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin, note: "Approved for the heritage page." });
    expect(result.created).toBe(true);
    const [row] = await listApprovalHistory(page.id);
    expect(row).toMatchObject({ scope: "PAGE", approvedById: users.admin, revokedAt: null, note: "Approved for the heritage page." });
    expect(row.approvedBy?.name).toBeTruthy();
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).unlistedPublicationApprovedAt).not.toBeNull();
    const actions = (await prisma.auditLogEntry.findMany({ where: { entityId: page.id } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["VIDEO_EXPOSURE_APPROVED", "VIDEO_PAGE_UNLISTED_PUBLICATION_APPROVED"]));
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).privacyStatus).toBe("unlisted"); // YouTube privacy is never changed
    expect(await findApprovalFlagInconsistencies()).toEqual({ flagWithoutApproval: [], approvalWithoutFlag: [] });
  }, T);

  it("approving again changes nothing (idempotent): one active row, no new history", async () => {
    const { page } = await newPublishedPage("unlisted");
    const first = await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    const second = await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    expect(second).toEqual({ approvalId: first.approvalId, created: false });
    expect(await prisma.videoExposureApproval.count({ where: { videoPageId: page.id } })).toBe(1);
  }, T);

  it("simultaneous identical approvals leave exactly one active approval (serialized under the page lock)", async () => {
    const { page } = await newPublishedPage("unlisted");
    await Promise.all(Array.from({ length: 5 }, () => approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin })));
    expect(await prisma.videoExposureApproval.count({ where: { videoPageId: page.id, scope: "PAGE", revokedAt: null } })).toBe(1);
  }, T);

  it("only an UNLISTED, available video can be approved: public and private are refused, and so is an unavailable one", async () => {
    const pub = await newPublishedPage("public");
    const priv = await newPublishedPage("private");
    const gone = await newPublishedPage("unlisted", "NOT_OBSERVED");
    await expect(approveExposure({ videoPageId: pub.page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalNotApplicableError);
    await expect(approveExposure({ videoPageId: priv.page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalNotApplicableError);
    await expect(approveExposure({ videoPageId: gone.page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(VideoNotAvailableError);
    for (const { page } of [pub, priv, gone]) expect(await prisma.videoExposureApproval.count({ where: { videoPageId: page.id } })).toBe(0);
  }, T);

  it("discovery and playlist exposure need the page approved first, and playlist approvals must name a playlist page", async () => {
    const { page } = await newPublishedPage("unlisted");
    await expect(approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalPrerequisiteError);
    await expect(approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: randomUUID(), actorId: users.admin })).rejects.toBeInstanceOf(ApprovalPrerequisiteError);
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await expect(approveExposure({ videoPageId: page.id, scope: "PLAYLIST", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    await expect(approveExposure({ videoPageId: page.id, scope: "DISCOVERY", playlistPageId: "pl-1", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    // the playlist page must exist, not be archived, and the video must be one of its curated members
    await expect(approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: randomUUID(), actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    const notMember = await playlistWith(null);
    await expect(approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: notMember.id, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    const archived = await playlistWith(page.id);
    await archivePlaylistPage({ id: archived.id, actorId: users.admin });
    await expect(approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: archived.id, actorId: users.admin })).rejects.toBeInstanceOf(ApprovalInvalidError);
    const playlist = await playlistWith(page.id);
    await approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: playlist.id, actorId: users.admin });
    expect(await active(page.id)).toEqual(expect.arrayContaining([{ scope: "PAGE", playlistPageId: null }, { scope: "PLAYLIST", playlistPageId: playlist.id }]));
  }, T);

  it("a recorded rights/copyright hold blocks approval until it is cleared", async () => {
    const { page, video } = await newPublishedPage("unlisted");
    const review = await prisma.videoExposureReview.create({ data: { youtubeVideoId: video.id, proposalFingerprint: "f", holdReason: "RIGHTS", state: "DECLINED" } });
    await expect(approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin })).rejects.toBeInstanceOf(ApprovalBlockedByHoldError);
    expect(await prisma.videoExposureApproval.count({ where: { videoPageId: page.id } })).toBe(0);
    await prisma.videoExposureReview.update({ where: { id: review.id }, data: { holdReason: null } });
    await expect(approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin })).resolves.toMatchObject({ created: true });
  }, T);
});

describe("what visitors can reach, scope by scope, through the real repositories", () => {
  it("page approval: reachable by URL but not listed; discovery approval lists it; revoking discovery unlists it but keeps the page", async () => {
    const { page } = await newPublishedPage("unlisted");
    expect(await findPublishedBySlug(page.slug)).toBeNull(); // nothing approved yet

    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: false });
    expect((await listPublishedVideoPages(500)).some((r) => r.page.id === page.id)).toBe(false);

    await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: true });
    expect((await listPublishedVideoPages(500)).some((r) => r.page.id === page.id)).toBe(true);

    expect(await revokeExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin, note: "Not for the catalogue." })).toEqual({ revoked: 1 });
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: false }); // still reachable
    expect((await listPublishedVideoPages(500)).some((r) => r.page.id === page.id)).toBe(false);
  }, T);

  it("revoking the PAGE approval removes EVERY scope with it, keeps the history, and changes nothing on YouTube", async () => {
    const { page, video } = await newPublishedPage("unlisted");
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
    await approveExposure({ videoPageId: page.id, scope: "PLAYLIST", playlistPageId: (await playlistWith(page.id)).id, actorId: users.admin });

    const revoked = await revokeExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.editor });
    expect(revoked.revoked).toBe(3);
    expect(await active(page.id)).toEqual([]);
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect((await listPublishedVideoPages(500)).some((r) => r.page.id === page.id)).toBe(false);
    expect((await prisma.youTubeVideoPage.findUniqueOrThrow({ where: { id: page.id } })).unlistedPublicationApprovedAt).toBeNull();
    expect((await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } })).privacyStatus).toBe("unlisted");

    const history = await listApprovalHistory(page.id);
    expect(history).toHaveLength(3); // nothing deleted
    expect(history.every((h) => h.revokedAt !== null && h.revokedById === users.editor)).toBe(true);
    expect(history.filter((h) => h.scope !== "PAGE").every((h) => /together with the page approval/i.test(h.revokeNote ?? ""))).toBe(true);
    expect((await prisma.auditLogEntry.findMany({ where: { entityId: page.id } })).map((a) => a.action)).toEqual(expect.arrayContaining(["VIDEO_EXPOSURE_REVOKED", "VIDEO_PAGE_UNLISTED_PUBLICATION_REVOKED"]));
    expect(await findApprovalFlagInconsistencies()).toEqual({ flagWithoutApproval: [], approvalWithoutFlag: [] });
  }, T);

  it("a video that becomes PRIVATE on YouTube after approval is hidden at once, without anyone revoking (YouTube stays authoritative)", async () => {
    const { page, video } = await newPublishedPage("unlisted");
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
    await prisma.youTubeVideo.update({ where: { id: video.id }, data: { privacyStatus: "private" } });
    expect(await findPublishedBySlug(page.slug)).toBeNull();
    expect((await listPublishedVideoPages(500)).some((r) => r.page.id === page.id)).toBe(false);
  }, T);

  it("a public video needs no approval and is listed (the exception is only for unlisted videos)", async () => {
    const { page } = await newPublishedPage("public");
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: true });
    expect((await listPublishedVideoPages(500)).some((r) => r.page.id === page.id)).toBe(true);
  }, T);
});

describe("permissions (Server Actions)", () => {
  it("only someone who may publish can approve or revoke exposure; an Editor is refused and nothing is recorded", async () => {
    const { page, video } = await newPublishedPage("unlisted");
    as("editor");
    expect(await redirectOf(() => approveUnlistedPublicationAction(video.id, page.id))).toMatch(/permission/i);
    expect(await prisma.videoExposureApproval.count({ where: { videoPageId: page.id } })).toBe(0);

    as("admin");
    await redirectOf(() => approveUnlistedPublicationAction(video.id, page.id));
    await redirectOf(() => approveDiscoveryAction(video.id, page.id));
    expect((await active(page.id)).map((a) => a.scope).sort()).toEqual(["DISCOVERY", "PAGE"]);

    as("editor");
    expect(await redirectOf(() => revokeDiscoveryAction(video.id, page.id))).toMatch(/permission/i);
    expect((await active(page.id)).some((a) => a.scope === "DISCOVERY")).toBe(true);
    as("admin");
    await redirectOf(() => revokeDiscoveryAction(video.id, page.id));
    expect((await active(page.id)).some((a) => a.scope === "DISCOVERY")).toBe(false);
  }, T);

  it("approving listing before the page is approved reports the prerequisite instead of failing", async () => {
    const { page, video } = await newPublishedPage("unlisted");
    as("admin");
    expect(await redirectOf(() => approveDiscoveryAction(video.id, page.id))).toMatch(/approve the public page first/i);
  }, T);
});

describe("migration safety: the legacy flag is mirrored into the approval history", () => {
  it("the data step creates exactly one PAGE approval for a flagged page (approver = its last editor), never a DISCOVERY or PLAYLIST one", async () => {
    const { page } = await newPublishedPage("unlisted");
    await prisma.youTubeVideoPage.update({ where: { id: page.id }, data: { unlistedPublicationApprovedAt: new Date("2026-01-01T00:00:00Z"), updatedById: users.editor } }); // a pre-6K-2 approval: flag only
    const migration = readFileSync(path.join(process.cwd(), "prisma", "migrations", "20261021110000_phase6k2_video_exposure_approvals_and_review", "migration.sql"), "utf8");
    const step = migration.slice(migration.indexOf("INSERT INTO"));
    expect(step).toMatch(/WHERE p\."unlistedPublicationApprovedAt" IS NOT NULL;\s*$/);
    await prisma.$executeRawUnsafe(step.replace('WHERE p."unlistedPublicationApprovedAt" IS NOT NULL;', `WHERE p."unlistedPublicationApprovedAt" IS NOT NULL AND p."id" = '${page.id}';`)); // the real statement, limited to this fixture page
    const rows = await listApprovalHistory(page.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scope: "PAGE", approvedById: users.editor, revokedAt: null });
    expect(rows[0].approvedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(rows[0].note).toMatch(/legacy/i);
    expect(await findPublishedBySlug(page.slug)).toMatchObject({ discoverable: false }); // reachable, but newly NOT listed: no discovery approval was invented
  }, T);
});
