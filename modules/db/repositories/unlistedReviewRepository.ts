import { writeAuditLog } from "../../audit/writeAuditLog";
import { ApprovalPrerequisiteError, ApprovalInvalidError } from "../../mmke/catalogue/videoExposureErrors";
import { buildQueueNotification, classifyReview, computeProposalFingerprint, type QueueSummaryItem, type ReviewClass } from "../../mmke/videoReview/reviewQueue";
import { ReviewChangedError, ReviewDecisionInvalidError, ReviewNotFoundError } from "../../mmke/videoReview/reviewErrors";
import { prisma } from "../client";
import { loadResolvedSettings } from "./siteSettingRepository";
import { CARRIED_OVER_NOTIFICATION_KEY, syncCarriedOverNotification } from "./carriedOverApprovalsRepository";
import { raiseNotification, resolveNotification } from "./studioNotificationRepository";
import { approveExposureIn, revokeExposureIn } from "./videoExposureRepository";
import { loadApprovalLifecycleStatuses, type ApprovalLifecycleView } from "./videoLifecycleRepository";
import { METADATA_REVIEW_NOTIFICATION_KEY, syncMetadataReviewNotification } from "./videoMetadataReviewRepository";
import type { Prisma, VideoExposureHold, VideoReviewDecisionKind, VideoReviewState } from "@prisma/client";

// Phase 6K-2 — the review queue for UNLISTED videos.
//
// Every unlisted, currently observed YouTube video is a candidate for a public Music Madras page. A review row records where each stands
// (pending / info requested / deferred / declined / approved), a decision history records who decided what and when, and a proposal
// fingerprint makes the queue honest: an unchanged item is never surfaced again as new; a changed item (or a deferral that has fallen
// due) is. A recorded hold (rights, copyright, privacy) is never overridden: it blocks approval and keeps a declined item from
// resurfacing. The platform only ASKS for decisions. Deciding needs RECORDING_PUBLISH (enforced by the calling Server Action); this code
// never approves anything by itself and never touches YouTube.
//
// A video the sync did NOT observe (NOT_OBSERVED) is not a candidate and is never treated as private or unavailable: its review row and its
// approvals are left exactly as they are (see modules/mmke/catalogue/videoLifecycle.ts).

export const UNLISTED_REVIEW_DEDUPE_KEY = "unlisted-review";
export const UNLISTED_REVIEW_HREF = "/studio/catalogue/unlisted-review";

type Client = Prisma.TransactionClient | typeof prisma;

const videoSelect = {
  id: true,
  youtubeVideoId: true,
  title: true,
  description: true,
  privacyStatus: true,
  durationSeconds: true,
  observabilityState: true,
  publishedAt: true,
  currentViewCount: true,
  videoPage: {
    select: {
      id: true,
      slug: true,
      status: true,
      archivedAt: true,
      playlistItems: { select: { playlistPage: { select: { id: true, title: true, archivedAt: true } } } },
    },
  },
  exposureReview: true,
} satisfies Prisma.YouTubeVideoSelect;

type CandidateRow = Prisma.YouTubeVideoGetPayload<{ select: typeof videoSelect }>;

export interface QueueItem {
  videoId: string;
  youtubeVideoId: string;
  title: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  fingerprint: string;
  class: ReviewClass;
  awaitingDecision: boolean;
  state: VideoReviewState | null;
  deferUntil: Date | null;
  infoRequest: string | null;
  holdReason: VideoExposureHold | null;
  holdNote: string | null;
  page: { id: string; slug: string; status: string; archived: boolean } | null;
  activeScopes: string[];
  /** What Studio says about the page's approval (approved / metadata review pending / revoked by the lifecycle / awaiting a fresh approval / not approved); null without a page. */
  lifecycle: ApprovalLifecycleView | null;
  /** The (non-archived) playlist pages this video has been chosen for, and whether each already has an active approval for this video. */
  playlists: Array<{ id: string; title: string; approved: boolean }>;
}

const fingerprintOf = (v: CandidateRow) =>
  computeProposalFingerprint({ title: v.title, description: v.description, privacyStatus: v.privacyStatus, durationSeconds: v.durationSeconds, observabilityState: v.observabilityState, publishedAt: v.publishedAt });

const CANDIDATE_WHERE = { privacyStatus: "unlisted", observabilityState: "OBSERVED" } satisfies Prisma.YouTubeVideoWhereInput;

/** Candidates in a STABLE order (id), so a batch cursor never skips or repeats a record. */
async function loadCandidateBatch(client: Client, batchSize: number, cursor?: string): Promise<CandidateRow[]> {
  return client.youTubeVideo.findMany({ where: cursor ? { AND: [CANDIDATE_WHERE, { id: { gt: cursor } }] } : CANDIDATE_WHERE, select: videoSelect, orderBy: { id: "asc" }, take: batchSize }); // keyset pagination: stable however the set changes
}

async function loadCandidates(client: Client): Promise<CandidateRow[]> {
  return client.youTubeVideo.findMany({ where: CANDIDATE_WHERE, select: videoSelect, orderBy: [{ publishedAt: "desc" }, { id: "asc" }] });
}

async function activeScopesByPage(client: Client, pageIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (pageIds.length === 0) return out;
  const rows = await client.videoExposureApproval.findMany({ where: { videoPageId: { in: pageIds }, revokedAt: null }, select: { videoPageId: true, scope: true } });
  for (const r of rows) out.set(r.videoPageId, [...(out.get(r.videoPageId) ?? []), r.scope]);
  return out;
}

/**
 * Creates the review row for a video if it does not exist yet, and returns it. Safe under concurrency: two callers racing to create the same
 * row (two sweeps, or a sweep and a decision) both succeed and see the one row, instead of one failing on the unique index.
 */
async function ensureReview(tx: Prisma.TransactionClient, videoId: string, fingerprint: string, state: VideoReviewState = "PENDING") {
  await tx.videoExposureReview.createMany({ data: [{ youtubeVideoId: videoId, state, proposalFingerprint: fingerprint }], skipDuplicates: true });
  return tx.videoExposureReview.findUniqueOrThrow({ where: { youtubeVideoId: videoId } });
}

/** The active hold on a video, if any (a hold can exist for any video, not only an unlisted one). */
export async function getVideoHold(videoId: string, client: Client = prisma): Promise<{ holdReason: VideoExposureHold | null; holdNote: string | null } | null> {
  const row = await client.videoExposureReview.findUnique({ where: { youtubeVideoId: videoId }, select: { holdReason: true, holdNote: true } });
  return row && row.holdReason ? row : null;
}

/** Active PLAYLIST approvals, keyed "videoPageId:playlistPageId". */
async function playlistApprovalIndex(client: Client, pageIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (pageIds.length === 0) return out;
  const rows = await client.videoExposureApproval.findMany({ where: { videoPageId: { in: pageIds }, scope: "PLAYLIST", revokedAt: null }, select: { videoPageId: true, playlistPageId: true } });
  for (const r of rows) if (r.playlistPageId) out.set(`${r.videoPageId}:${r.playlistPageId}`, true);
  return out;
}

function toItem(v: CandidateRow, scopes: Map<string, string[]>, playlistApprovals: Map<string, boolean>, now: Date, lifecycle: Map<string, ApprovalLifecycleView> = new Map()): QueueItem {
  const fingerprint = fingerprintOf(v);
  const active = v.videoPage ? (scopes.get(v.videoPage.id) ?? []) : [];
  const review = v.exposureReview;
  const verdict = classifyReview({
    review: review ? { state: review.state, proposalFingerprint: review.proposalFingerprint, deferUntil: review.deferUntil, holdReason: review.holdReason } : null,
    fingerprint,
    now,
    hasActivePageApproval: active.includes("PAGE"),
    pageArchived: v.videoPage?.archivedAt != null,
  });
  return {
    videoId: v.id,
    youtubeVideoId: v.youtubeVideoId,
    title: v.title,
    durationSeconds: v.durationSeconds,
    viewCount: v.currentViewCount,
    fingerprint,
    class: verdict.class,
    awaitingDecision: verdict.awaitingDecision,
    state: review?.state ?? null,
    deferUntil: review?.deferUntil ?? null,
    infoRequest: review?.infoRequest ?? null,
    holdReason: review?.holdReason ?? null,
    holdNote: review?.holdNote ?? null,
    page: v.videoPage ? { id: v.videoPage.id, slug: v.videoPage.slug, status: v.videoPage.status, archived: v.videoPage.archivedAt !== null } : null,
    activeScopes: active,
    lifecycle: v.videoPage ? (lifecycle.get(v.videoPage.id) ?? null) : null,
    playlists: (v.videoPage?.playlistItems ?? [])
      .filter((i) => i.playlistPage.archivedAt === null)
      .map((i) => ({ id: i.playlistPage.id, title: i.playlistPage.title, approved: playlistApprovals.get(`${v.videoPage!.id}:${i.playlistPage.id}`) === true })),
  };
}

/** The queue as it stands now (read-only): awaiting items first, then the rest. */
export async function loadReviewQueue(now: Date = new Date(), client: Client = prisma): Promise<QueueItem[]> {
  const videos = await loadCandidates(client);
  const pageIds = videos.flatMap((v) => (v.videoPage ? [v.videoPage.id] : []));
  const scopes = await activeScopesByPage(client, pageIds);
  const playlistApprovals = await playlistApprovalIndex(client, pageIds);
  const lifecycle = await loadApprovalLifecycleStatuses(
    videos.flatMap((v) => (v.videoPage ? [{ videoPageId: v.videoPage.id, privacyStatus: v.privacyStatus, observabilityState: v.observabilityState, archived: v.videoPage.archivedAt !== null }] : [])),
    client
  );
  const items = videos.map((v) => toItem(v, scopes, playlistApprovals, now, lifecycle));
  const rank = (i: QueueItem) => (i.awaitingDecision ? 0 : 1);
  return items.sort((a, b) => rank(a) - rank(b));
}

/** A seam for tests only: lets a test interleave another writer between the sweep's read and its writes. Production callers pass nothing. */
export interface SweepTestHooks {
  afterRead?: () => Promise<void>;
  /** Tests only: called before each batch with its 1-based number; may throw to simulate a failing batch. */
  beforeBatch?: (batch: number) => Promise<void>;
  /** Tests only: overrides the batch size. */
  batchSize?: number;
}

/** A technical bound: candidates handled per batch. Each batch is its own short transaction, so no catalogue size can run into the transaction time limit. */
export const REVIEW_SWEEP_BATCH = 100;
/** The interactive-transaction time limit for one batch (Prisma's default is 5 s). A batch is small; this is headroom for a slow connection, not a budget. */
const BATCH_TRANSACTION_TIMEOUT_MS = 20_000;

export interface SweepResult {
  enabled: boolean;
  candidates: number;
  awaiting: number;
  created: number;
  resurfaced: number;
  notification: "RAISED" | "UNCHANGED" | "RESOLVED" | "NONE";
  /** Batches processed, and how many of them failed. A failed batch leaves its records as they were (they are retried by the next run). */
  batches: number;
  failedBatches: number;
  /** False when any batch failed: the queue notification is then left as it was, because the awaiting set is not fully known. */
  completed: boolean;
}

/** One batch, in one short transaction: bring its review rows up to date and report which of its videos await a decision. */
async function processBatch(tx: Prisma.TransactionClient, rows: CandidateRow[], now: Date, hooks: SweepTestHooks): Promise<{ created: number; resurfaced: number; awaiting: QueueSummaryItem[] }> {
  const scopes = await activeScopesByPage(tx, rows.flatMap((v) => (v.videoPage ? [v.videoPage.id] : [])));
  let created = 0;
  let resurfaced = 0;
  await hooks.afterRead?.();
  for (const video of rows) {
    const fingerprint = fingerprintOf(video);
    const hasPageApproval = video.videoPage ? (scopes.get(video.videoPage.id) ?? []).includes("PAGE") : false;
    const review = video.exposureReview;
    const pageArchived = video.videoPage?.archivedAt != null;
    if (!review) {
      // A video already approved before the review existed is recorded as approved, not asked about again.
      // `skipDuplicates`: a concurrent sweep (or a decision) may create the row first; that is fine and is not an error.
      const made = await tx.videoExposureReview.createMany({ data: [{ youtubeVideoId: video.id, state: hasPageApproval ? "APPROVED" : "PENDING", proposalFingerprint: fingerprint }], skipDuplicates: true });
      if (made.count === 1 && !hasPageApproval && !pageArchived) created += 1;
      continue;
    }
    const verdict = classifyReview({ review: { state: review.state, proposalFingerprint: review.proposalFingerprint, deferUntil: review.deferUntil, holdReason: review.holdReason }, fingerprint, now, hasActivePageApproval: hasPageApproval, pageArchived });
    // Every write is conditional on the row still being exactly what this sweep read, so a decision (or another sweep) that landed in between
    // is never overwritten with a decision made on stale information.
    const unchanged = { id: review.id, state: review.state, proposalFingerprint: review.proposalFingerprint };
    if (verdict.class === "CHANGED" || verdict.class === "DUE" || verdict.class === "NEEDS_DECISION") {
      const moved = await tx.videoExposureReview.updateMany({ where: unchanged, data: { state: "PENDING", proposalFingerprint: fingerprint, deferUntil: null, lastSurfacedAt: now } });
      if (moved.count === 1) resurfaced += 1;
    } else if (verdict.class === "PENDING" && review.proposalFingerprint !== fingerprint) {
      await tx.videoExposureReview.updateMany({ where: unchanged, data: { proposalFingerprint: fingerprint } }); // keep what a reviewer will be shown current
    } else if (verdict.class === "APPROVED" && review.proposalFingerprint !== fingerprint) {
      // An approved item's later edits do not re-ask here: material changes to an approved page are tracked as a pending METADATA review
      // (videoMetadataReviewRepository.ts), which keeps the page public while an editor looks at it.
      await tx.videoExposureReview.updateMany({ where: unchanged, data: { proposalFingerprint: fingerprint } });
    }
  }
  // Which of these now await a decision, from the rows as they stand AFTER the writes above.
  const after = await tx.youTubeVideo.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: videoSelect });
  const awaiting = after.map((v) => toItem(v, scopes, new Map(), now)).filter((i) => i.awaitingDecision).map((i) => ({ videoId: i.videoId, fingerprint: i.fingerprint, class: i.class, title: i.title }));
  return { created, resurfaced, awaiting };
}

/**
 * Brings the review rows up to date with the synced catalogue and keeps the single queue notification accurate. Idempotent and safe to
 * run as often as you like: it changes a review row only when the facts changed, a deferral fell due or an approval ended elsewhere,
 * and the notification only when its fingerprint changes (a new/changed set, or once per reminder window).
 *
 * It works in BOUNDED BATCHES in a stable order, each in its own short transaction, so one oversized catalogue can never run into the transaction
 * time limit and roll everything back: a batch that fails leaves only its own records for the next run, and the result says so (`failedBatches`).
 * The queue notification is updated only when every batch succeeded.
 */
export async function runUnlistedReviewSweep(now: Date = new Date(), hooks: SweepTestHooks = {}): Promise<SweepResult> {
  const settings = await loadResolvedSettings();
  if (!settings.get("unlistedReview.enabled")) {
    const closed = await resolveNotification(UNLISTED_REVIEW_DEDUPE_KEY, "The unlisted-video review is switched off in settings.");
    await resolveNotification(CARRIED_OVER_NOTIFICATION_KEY, "The unlisted-video review is switched off in settings.");
    await resolveNotification(METADATA_REVIEW_NOTIFICATION_KEY, "The unlisted-video review is switched off in settings.");
    return { enabled: false, candidates: 0, awaiting: 0, created: 0, resurfaced: 0, notification: closed ? "RESOLVED" : "NONE", batches: 0, failedBatches: 0, completed: true };
  }
  const cadenceDays = settings.get("unlistedReview.cadenceDays");
  const batchSize = hooks.batchSize ?? REVIEW_SWEEP_BATCH;

  const awaiting: QueueSummaryItem[] = [];
  let candidates = 0;
  let created = 0;
  let resurfaced = 0;
  let batches = 0;
  let failedBatches = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await loadCandidateBatch(prisma, batchSize, cursor);
    if (rows.length === 0) break;
    batches += 1;
    cursor = rows[rows.length - 1].id;
    candidates += rows.length;
    try {
      await hooks.beforeBatch?.(batches);
      const out = await prisma.$transaction((tx) => processBatch(tx, rows, now, hooks), { timeout: BATCH_TRANSACTION_TIMEOUT_MS });
      created += out.created;
      resurfaced += out.resurfaced;
      awaiting.push(...out.awaiting);
    } catch (err) {
      failedBatches += 1;
      console.error(`Unlisted-video review sweep: batch ${batches} failed and will be retried by the next run:`, err instanceof Error ? err.name : "unknown error");
    }
    if (rows.length < batchSize) break;
  }

  const completed = failedBatches === 0;
  let notification: SweepResult["notification"] = "NONE";
  if (completed) {
    const message = buildQueueNotification(awaiting, now, cadenceDays);
    if (!message) {
      notification = (await resolveNotification(UNLISTED_REVIEW_DEDUPE_KEY, "No unlisted video is awaiting a decision.")) ? "RESOLVED" : "NONE";
    } else {
      const raised = await raiseNotification({ kind: "UNLISTED_REVIEW_PENDING", dedupeKey: UNLISTED_REVIEW_DEDUPE_KEY, title: message.title, body: message.body, href: UNLISTED_REVIEW_HREF, contentFingerprint: message.fingerprint });
      notification = raised.outcome === "UNCHANGED" ? "UNCHANGED" : "RAISED";
    }
  }
  await syncCarriedOverNotification();
  await syncMetadataReviewNotification();
  return { enabled: true, candidates, awaiting: awaiting.length, created, resurfaced, notification, batches, failedBatches, completed };
}

export type ReviewDecision =
  | { kind: "APPROVE"; scopes: Array<"PAGE" | "DISCOVERY">; playlistPageIds?: string[] }
  | { kind: "REQUEST_INFO"; infoRequest: string }
  | { kind: "DEFER"; until?: Date }
  | { kind: "DECLINE" }
  | { kind: "REVOKE" };

export interface DecideReviewInput {
  videoId: string; // YouTubeVideo.id
  /** The fingerprint the reviewer was shown; the decision is refused if the video has changed since. */
  expectedFingerprint: string;
  decision: ReviewDecision;
  actorId: string;
  note?: string | null;
}

const MAX_NOTE = 2000;

const STATE_FOR: Record<ReviewDecision["kind"], VideoReviewState> = { APPROVE: "APPROVED", REQUEST_INFO: "INFO_REQUESTED", DEFER: "DEFERRED", DECLINE: "DECLINED", REVOKE: "DECLINED" };

/** Records one decision atomically with whatever exposure change it implies. Holds are never overridden. */
export async function decideReview(input: DecideReviewInput): Promise<{ state: VideoReviewState }> {
  const note = input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;
  const decision = input.decision;
  if (decision.kind === "REQUEST_INFO" && !decision.infoRequest.trim()) throw new ReviewDecisionInvalidError("Say what information is needed.");
  if (decision.kind === "APPROVE" && (decision.scopes.length === 0 || !decision.scopes.includes("PAGE"))) throw new ReviewDecisionInvalidError("Approving needs at least the public page.");

  const settings = await loadResolvedSettings();
  const deferDays = settings.get("unlistedReview.deferDays");

  return prisma.$transaction(async (tx) => {
    const video = await tx.youTubeVideo.findUnique({ where: { id: input.videoId }, select: videoSelect });
    if (!video || video.privacyStatus !== "unlisted") throw new ReviewNotFoundError();
    // The review row is created if missing (race-safe) and then locked, so two decisions on one video are serialized.
    const ensured = await ensureReview(tx, video.id, fingerprintOf(video));
    await tx.$queryRaw`select id from video_exposure_reviews where id = ${ensured.id} for update`;
    const current = await tx.youTubeVideo.findUnique({ where: { id: input.videoId }, select: videoSelect });
    if (!current || !current.exposureReview) throw new ReviewNotFoundError();
    const fingerprint = fingerprintOf(current);
    if (fingerprint !== input.expectedFingerprint) throw new ReviewChangedError();

    const review = current.exposureReview;

    const scopesApplied: string[] = [];
    let revokedApprovals = 0;
    if (decision.kind === "APPROVE") {
      if (!current.videoPage) throw new ApprovalPrerequisiteError(); // approval is of a page; the page must exist first
      for (const scope of decision.scopes) {
        await approveExposureIn(tx, { videoPageId: current.videoPage.id, scope, actorId: input.actorId, note }); // throws if a hold blocks it or the page is archived
        scopesApplied.push(scope);
      }
      // Specific playlist pages (each must exist, be un-archived, and already have this video as a curated member).
      for (const playlistPageId of [...new Set(decision.playlistPageIds ?? [])]) {
        await approveExposureIn(tx, { videoPageId: current.videoPage.id, scope: "PLAYLIST", playlistPageId, actorId: input.actorId, note });
        scopesApplied.push(`PLAYLIST:${playlistPageId}`);
      }
    } else if (current.videoPage) {
      // DECLINE, REVOKE, DEFER and REQUEST_INFO all mean "this is not approved right now": any approval the video already has is revoked (PAGE
      // revokes every scope with it), so what visitors can see always matches the decision on record. Coming back to it later needs an explicit
      // new approval — nothing is restored automatically. A video with no active approval is simply left as it is.
      const revoked = await revokeExposureIn(tx, { videoPageId: current.videoPage.id, scope: "PAGE", actorId: input.actorId, reason: "REVIEW_DECISION", note: note ?? `Review: ${decision.kind.toLowerCase().replace("_", " ")}` });
      revokedApprovals = revoked.revoked;
    }

    const state = STATE_FOR[decision.kind];
    const deferUntil =
      decision.kind === "DEFER" ? (decision.until ?? new Date(Date.now() + deferDays * 86_400_000)) : null;
    if (decision.kind === "DEFER" && deferUntil && deferUntil.getTime() <= Date.now()) throw new ReviewDecisionInvalidError("Choose a deferral date in the future.");

    await tx.videoExposureReview.update({
      where: { id: review.id },
      data: {
        state,
        proposalFingerprint: fingerprint,
        deferUntil,
        infoRequest: decision.kind === "REQUEST_INFO" ? decision.infoRequest.trim().slice(0, MAX_NOTE) : decision.kind === "APPROVE" ? null : review.infoRequest,
        decidedById: input.actorId,
        decidedAt: new Date(),
      },
    });
    await tx.videoExposureReviewDecision.create({
      data: { reviewId: review.id, kind: decision.kind as VideoReviewDecisionKind, note, scopes: scopesApplied.length ? scopesApplied : undefined, actorId: input.actorId },
    });
    await writeAuditLog(
      { actorId: input.actorId, action: "VIDEO_REVIEW_DECIDED", entityType: "YouTubeVideo", entityId: current.id, beforeSnapshot: { state: review.state }, afterSnapshot: { state, decision: decision.kind, scopes: scopesApplied, revokedApprovals } },
      tx
    );
    return { state };
  });
}

/** Records a rights/copyright/privacy hold: removes the page from public view at once and blocks approval until it is cleared. */
export async function setReviewHold(input: { videoId: string; hold: VideoExposureHold; note?: string | null; actorId: string }): Promise<void> {
  const note = input.note?.trim() ? input.note.trim().slice(0, MAX_NOTE) : null;
  await prisma.$transaction(async (tx) => {
    const video = await tx.youTubeVideo.findUnique({ where: { id: input.videoId }, select: videoSelect });
    if (!video) throw new ReviewNotFoundError();
    const fingerprint = fingerprintOf(video);
    const review = await ensureReview(tx, video.id, fingerprint);
    await tx.$queryRaw`select id from video_exposure_reviews where id = ${review.id} for update`;
    if (video.videoPage) await revokeExposureIn(tx, { videoPageId: video.videoPage.id, scope: "PAGE", actorId: input.actorId, reason: "HOLD", note: `Hold: ${input.hold.toLowerCase()}` });
    await tx.videoExposureReview.update({ where: { id: review.id }, data: { holdReason: input.hold, holdNote: note, state: "DECLINED", proposalFingerprint: fingerprint, deferUntil: null, decidedById: input.actorId, decidedAt: new Date() } });
    await tx.videoExposureReviewDecision.create({ data: { reviewId: review.id, kind: "HOLD_SET", note: `${input.hold}${note ? ` — ${note}` : ""}`, actorId: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "VIDEO_REVIEW_HOLD_SET", entityType: "YouTubeVideo", entityId: video.id, afterSnapshot: { hold: input.hold } }, tx);
  });
}

/**
 * Clears a hold. Nothing is approved by clearing it, and earlier approvals stay revoked. What happens next depends on the video: a PUBLIC video whose
 * page is published is visible again immediately (public videos need no approval); an UNLISTED video stays hidden until someone approves it afresh,
 * and returns to the review queue for that decision.
 */
export async function clearReviewHold(input: { videoId: string; actorId: string }): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const found = await tx.videoExposureReview.findUnique({ where: { youtubeVideoId: input.videoId } });
    if (!found || !found.holdReason) throw new ApprovalInvalidError("There is no hold to clear.");
    await tx.$queryRaw`select id from video_exposure_reviews where id = ${found.id} for update`;
    const review = await tx.videoExposureReview.findUniqueOrThrow({ where: { id: found.id } });
    if (!review.holdReason) throw new ApprovalInvalidError("There is no hold to clear.");
    await tx.videoExposureReview.update({ where: { id: review.id }, data: { holdReason: null, holdNote: null, state: "PENDING", lastSurfacedAt: new Date() } });
    await tx.videoExposureReviewDecision.create({ data: { reviewId: review.id, kind: "HOLD_CLEARED", note: `Was ${review.holdReason}`, actorId: input.actorId } });
    await writeAuditLog({ actorId: input.actorId, action: "VIDEO_REVIEW_HOLD_CLEARED", entityType: "YouTubeVideo", entityId: input.videoId, beforeSnapshot: { hold: review.holdReason } }, tx);
  });
}

export async function listReviewDecisions(videoId: string) {
  const review = await prisma.videoExposureReview.findUnique({ where: { youtubeVideoId: videoId }, select: { id: true } });
  if (!review) return [];
  return prisma.videoExposureReviewDecision.findMany({ where: { reviewId: review.id }, orderBy: { createdAt: "desc" }, include: { actor: { select: { name: true } } } });
}
