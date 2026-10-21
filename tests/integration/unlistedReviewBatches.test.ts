import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../modules/db/client";
import {
  UNLISTED_REVIEW_DEDUPE_KEY,
  clearReviewHold,
  decideReview,
  loadReviewQueue,
  runUnlistedReviewSweep,
  setReviewHold,
  listReviewDecisions,
} from "../../modules/db/repositories/unlistedReviewRepository";
import { approveExposure, listActiveApprovals } from "../../modules/db/repositories/videoExposureRepository";
import { archiveVideoPage, createDraftVideoPage, publishVideoPage } from "../../modules/db/repositories/youtubeVideoPageRepository";
import { setYouTubeVideoObservability, updateYouTubeVideoFields } from "../../modules/db/repositories/youtubeVideoRepository";
import { computeProposalFingerprint } from "../../modules/mmke/videoReview/reviewQueue";

// Phase 6K lifecycle hardening, F9 — the unlisted-video review sweep in bounded batches (so no catalogue size can run into a single transaction's time
// limit and roll everything back), with stable pagination, observable partial failure, idempotence under concurrency, and the F1/F11/F18 review rules
// that depend on it. Isolated test database.

const TAG = randomUUID().slice(0, 8);
const T = 180000;
const users = {} as Record<"admin", string>;
const videoIds: string[] = [];
const pageIds: string[] = [];
let counter = 0;
const ytId = (prefix: string, n: number) => `${prefix}${TAG.slice(0, 5)}${String(n).padStart(5, "0")}`; // 11 characters, unique per counter value

/** Many unlisted, observed videos at once (createMany), returning their ids. */
async function bulkUnlisted(count: number, prefix = "b"): Promise<string[]> {
  const batch = Array.from({ length: count }, () => ({ id: randomUUID(), youtubeVideoId: ytId(prefix, ++counter), title: `Batch ${TAG} ${counter}`, privacyStatus: "unlisted", observabilityState: "OBSERVED" as const }));
  await prisma.youTubeVideo.createMany({ data: batch });
  const ids = batch.map((b) => b.id);
  videoIds.push(...ids);
  return ids;
}
async function newPublishedPage(privacy = "unlisted") {
  const video = await prisma.youTubeVideo.create({ data: { youtubeVideoId: ytId("r", ++counter), title: `Review ${TAG} ${counter}`, privacyStatus: privacy, observabilityState: "OBSERVED" } });
  videoIds.push(video.id);
  const page = await createDraftVideoPage({ youtubeVideoId: video.id, actorId: users.admin });
  await publishVideoPage(page.id, users.admin);
  pageIds.push(page.id);
  return { video, page };
}
const reviewsFor = (ids: string[]) => prisma.videoExposureReview.findMany({ where: { youtubeVideoId: { in: ids } } });
const fingerprintOfRow = (v: { title: string | null; description: string | null; privacyStatus: string | null; durationSeconds: number | null; observabilityState: string; publishedAt: Date | null }) => computeProposalFingerprint(v);

beforeAll(async () => {
  users.admin = (await prisma.studioUser.create({ data: { id: randomUUID(), email: `x6kr-admin-${TAG}@musicmadras.test`, name: "Review admin", role: "ADMINISTRATOR", status: "ACTIVE" } })).id;
}, T);

afterAll(async () => {
  await prisma.studioNotification.deleteMany({ where: { dedupeKey: { in: [UNLISTED_REVIEW_DEDUPE_KEY, "carried-over-approvals", "metadata-review-pending"] } } });
  await prisma.auditLogEntry.deleteMany({ where: { OR: [{ entityId: { in: [...pageIds, ...videoIds] } }, { actorId: users.admin }] } });
  await prisma.youTubeVideoPage.deleteMany({ where: { id: { in: pageIds } } });
  await prisma.youTubeVideo.deleteMany({ where: { id: { in: videoIds } } });
  await prisma.studioUser.deleteMany({ where: { id: users.admin } });
}, T);

describe("a large catalogue is swept in bounded batches", () => {
  it("handles 350 unlisted videos in several short transactions, creates exactly one review each, raises the queue notification, and a second run changes nothing", async () => {
    const ids = await bulkUnlisted(350);
    let batchesSeen = 0;
    const started = Date.now();
    const first = await runUnlistedReviewSweep(new Date(), { afterRead: async () => void (batchesSeen += 1) });
    const elapsed = Date.now() - started;
    expect(first.completed).toBe(true);
    expect(first.failedBatches).toBe(0);
    expect(first.batches).toBeGreaterThanOrEqual(4); // 350 candidates at 100 per batch
    expect(batchesSeen).toBe(first.batches); // one short transaction per batch
    expect(first.candidates).toBeGreaterThanOrEqual(350);
    expect(first.created).toBeGreaterThanOrEqual(350);
    expect(await reviewsFor(ids)).toHaveLength(350);
    expect(first.notification).toMatch(/RAISED|UNCHANGED/);
    const notification = await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } });
    expect(notification.status).toBe("OPEN");
    expect(elapsed).toBeLessThan(120_000); // sanity: nowhere near a single-transaction time limit per batch

    const second = await runUnlistedReviewSweep();
    expect(second).toMatchObject({ created: 0, resurfaced: 0, failedBatches: 0, completed: true });
    expect(second.notification).toBe("UNCHANGED");
    expect(await reviewsFor(ids)).toHaveLength(350);
  }, T);

  it("pages through candidates in a stable order: a small batch size visits every record once, and a record added mid-sweep is picked up by the next run", async () => {
    const ids = await bulkUnlisted(23);
    let addedMidSweep: string | null = null;
    const first = await runUnlistedReviewSweep(new Date(), {
      batchSize: 5,
      beforeBatch: async (n) => {
        if (n === 2) addedMidSweep = (await bulkUnlisted(1, "m"))[0];
      },
    });
    expect(first.batches).toBeGreaterThanOrEqual(5);
    expect(await reviewsFor(ids)).toHaveLength(23); // none skipped, none doubled (a unique index would have refused a double)
    const second = await runUnlistedReviewSweep(new Date(), { batchSize: 5 });
    expect(second.failedBatches).toBe(0);
    expect(await reviewsFor([addedMidSweep!])).toHaveLength(1); // eventually complete
  }, T);

  it("a failing batch is counted and leaves only its own records for the next run; the others are kept; the queue notification is NOT rewritten from an incomplete picture", async () => {
    const standing = await prisma.studioNotification.findUnique({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } });
    expect(standing).not.toBeNull();
    const ids = await bulkUnlisted(14);
    // Set every OTHER candidate aside for the moment (not observed is simply not a candidate), so these 14 are the whole catalogue: batches of 5, 5 and 4.
    const others = await prisma.youTubeVideo.findMany({ where: { id: { notIn: ids }, privacyStatus: "unlisted", observabilityState: "OBSERVED" }, select: { id: true } });
    await prisma.youTubeVideo.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { observabilityState: "NOT_OBSERVED" } });
    let result: Awaited<ReturnType<typeof runUnlistedReviewSweep>>;
    try {
      result = await runUnlistedReviewSweep(new Date(), {
        batchSize: 5,
        beforeBatch: async (n) => {
          if (n === 3) throw new Error("simulated batch failure");
        },
      });
    } finally {
      await prisma.youTubeVideo.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { observabilityState: "OBSERVED" } });
    }
    expect(result.failedBatches).toBe(1);
    expect(result.completed).toBe(false);
    expect(result.notification).toBe("NONE");
    const after = await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } });
    expect({ status: after.status, fingerprint: after.contentFingerprint, title: after.title }).toEqual({ status: standing!.status, fingerprint: standing!.contentFingerprint, title: standing!.title }); // untouched
    const done = (await reviewsFor(ids)).length;
    expect(done).toBe(10); // the two batches that succeeded (5 + 5) stayed committed; the failed one (4 videos) has none

    const retry = await runUnlistedReviewSweep();
    expect(retry).toMatchObject({ failedBatches: 0, completed: true });
    expect(await reviewsFor(ids)).toHaveLength(14);
  }, T);

  it("three sweeps at once create one review per video and none fails", async () => {
    const ids = await bulkUnlisted(40);
    const results = await Promise.allSettled([runUnlistedReviewSweep(new Date(), { batchSize: 7 }), runUnlistedReviewSweep(new Date(), { batchSize: 11 }), runUnlistedReviewSweep()]);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    for (const r of results) if (r.status === "fulfilled") expect(r.value.failedBatches).toBe(0);
    expect(await reviewsFor(ids)).toHaveLength(40);
    const created = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.created : 0), 0);
    expect(created).toBeGreaterThanOrEqual(40); // each video is created exactly once across the three
  }, T);
});

describe("an unobserved video is not treated as private or unavailable", () => {
  it("is not a candidate, and its review row and approvals are left exactly as they were", async () => {
    const { video, page } = await newPublishedPage();
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await runUnlistedReviewSweep(); // records it as already approved
    const review = await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } });
    expect(review.state).toBe("APPROVED");
    await setYouTubeVideoObservability(video.id, "NOT_OBSERVED");
    await updateYouTubeVideoFields(video.id, { title: "Changed while it could not be seen" });
    const result = await runUnlistedReviewSweep();
    expect(result.failedBatches).toBe(0);
    expect(await prisma.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: video.id } })).toMatchObject({ state: "APPROVED", proposalFingerprint: review.proposalFingerprint });
    expect(((await listActiveApprovals([page.id])).get(page.id) ?? []).map((a) => a.scope)).toEqual(["PAGE"]);
    expect((await loadReviewQueue()).some((i) => i.videoId === video.id)).toBe(false);
  }, T);
});

describe("when an approval ends, the video needs a FRESH decision (F11) — and an archived page waits for restoration", () => {
  it("a video that went private and came back unlisted returns to the queue as 'awaiting a fresh approval'", async () => {
    const { video, page } = await newPublishedPage();
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await runUnlistedReviewSweep();
    await updateYouTubeVideoFields(video.id, { privacyStatus: "private" });
    await updateYouTubeVideoFields(video.id, { privacyStatus: "unlisted" });
    const sweep = await runUnlistedReviewSweep();
    expect(sweep.awaiting).toBeGreaterThanOrEqual(1);
    const item = (await loadReviewQueue()).find((i) => i.videoId === video.id)!;
    expect(item).toMatchObject({ awaitingDecision: true, class: "PENDING" });
    expect(item.lifecycle).toMatchObject({ status: "AWAITING_FRESH_APPROVAL" });
    expect(item.activeScopes).toEqual([]);
    const notification = await prisma.studioNotification.findUniqueOrThrow({ where: { dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY } });
    expect(notification.status).toBe("OPEN");
  }, T);

  it("an archived page is not awaiting a decision (it cannot be approved until restored), and the queue says why", async () => {
    const { video, page } = await newPublishedPage();
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await runUnlistedReviewSweep();
    await archiveVideoPage(page.id, users.admin);
    await runUnlistedReviewSweep();
    const item = (await loadReviewQueue()).find((i) => i.videoId === video.id)!;
    expect(item).toMatchObject({ class: "ARCHIVED_PAGE", awaitingDecision: false });
    expect(item.lifecycle!.status).toBe("REVOKED_BY_LIFECYCLE");
    await expect(decideReview({ videoId: video.id, expectedFingerprint: item.fingerprint, decision: { kind: "APPROVE", scopes: ["PAGE"] }, actorId: users.admin })).rejects.toThrow(/archived/);
  }, T);
});

describe("review history names each event as itself (F18), and revocations carry their reason (F1)", () => {
  it("records hold set, hold cleared, request-info and decline as four different kinds", async () => {
    const { video } = await newPublishedPage();
    await runUnlistedReviewSweep();
    const fp = () => prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } }).then(fingerprintOfRow);

    await decideReview({ videoId: video.id, expectedFingerprint: await fp(), decision: { kind: "REQUEST_INFO", infoRequest: "Who is the choir?" }, actorId: users.admin });
    await decideReview({ videoId: video.id, expectedFingerprint: await fp(), decision: { kind: "DECLINE" }, actorId: users.admin });
    await setReviewHold({ videoId: video.id, hold: "RIGHTS", note: "Pending clearance.", actorId: users.admin });
    await clearReviewHold({ videoId: video.id, actorId: users.admin });

    const kinds = (await listReviewDecisions(video.id)).map((d) => d.kind).sort();
    expect(kinds).toEqual(["DECLINE", "HOLD_CLEARED", "HOLD_SET", "REQUEST_INFO"]);
    expect(await prisma.auditLogEntry.count({ where: { entityId: video.id, action: { in: ["VIDEO_REVIEW_HOLD_SET", "VIDEO_REVIEW_HOLD_CLEARED"] } } })).toBe(2);
    const cleared = (await listReviewDecisions(video.id)).find((d) => d.kind === "HOLD_CLEARED")!;
    expect(cleared.note).toBe("Was RIGHTS");
  }, T);

  it("defer, request-info, decline and a hold each end the approval with their own recorded reason", async () => {
    for (const [name, act, reason] of [
      ["defer", (v: string, fp: string) => decideReview({ videoId: v, expectedFingerprint: fp, decision: { kind: "DEFER", until: new Date(Date.now() + 3 * 86_400_000) }, actorId: users.admin }), "REVIEW_DECISION"],
      ["request info", (v: string, fp: string) => decideReview({ videoId: v, expectedFingerprint: fp, decision: { kind: "REQUEST_INFO", infoRequest: "More please" }, actorId: users.admin }), "REVIEW_DECISION"],
      ["decline", (v: string, fp: string) => decideReview({ videoId: v, expectedFingerprint: fp, decision: { kind: "DECLINE" }, actorId: users.admin }), "REVIEW_DECISION"],
      ["hold", (v: string) => setReviewHold({ videoId: v, hold: "COPYRIGHT", actorId: users.admin }), "HOLD"],
    ] as const) {
      const { video, page } = await newPublishedPage();
      await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
      await approveExposure({ videoPageId: page.id, scope: "DISCOVERY", actorId: users.admin });
      await runUnlistedReviewSweep();
      const fresh = await prisma.youTubeVideo.findUniqueOrThrow({ where: { id: video.id } });
      await act(video.id, fingerprintOfRow(fresh));
      expect(((await listActiveApprovals([page.id])).get(page.id) ?? []).length, name).toBe(0);
      const rows = await prisma.videoExposureApproval.findMany({ where: { videoPageId: page.id } });
      expect(rows.every((r) => r.revokedReason === reason && r.revokedById === users.admin), name).toBe(true);
    }
  }, T);

  it("clearing a hold on an unlisted video approves nothing and puts it back in the queue for a fresh decision", async () => {
    const { video, page } = await newPublishedPage();
    await approveExposure({ videoPageId: page.id, scope: "PAGE", actorId: users.admin });
    await setReviewHold({ videoId: video.id, hold: "PRIVACY", actorId: users.admin });
    await clearReviewHold({ videoId: video.id, actorId: users.admin });
    expect(((await listActiveApprovals([page.id])).get(page.id) ?? [])).toEqual([]);
    const item = (await loadReviewQueue()).find((i) => i.videoId === video.id)!;
    expect(item).toMatchObject({ holdReason: null, awaitingDecision: true });
  }, T);
});
