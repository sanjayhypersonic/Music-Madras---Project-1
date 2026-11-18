// Upload-to-draft pipeline (R-34), stage 6: the OWNER'S APPROVAL. Orchestration over injected dependencies (Prisma-backed in
// modules/db/repositories/pipelineRepository.ts; fakes in the tests). Nothing publishes without this, and this runs only from a Studio action
// by a user with RECORDING_PUBLISH.
//
// Approve (one bundle):
//   1. every CONFLICT claim must carry the owner's explicit decision (code never resolves a conflict); other claims are accepted unless rejected;
//   2. the bundle is re-drafted with the DECIDED claims only (accepted claims; sameAs from accepted tier A/B sources), with the owner's edits to
//      the video page's SEO title, meta description and summary on top;
//   3. the catalogue is written through the EXISTING creation tool (planVideo + executeCreditsPlans), as the approving editor: exact-normalised
//      matching, the slug rule, DRAFT Recording, empty slots only; then arrangers, lyricists, ensembles and person pages are linked;
//   4. the Recording's draft gets the SEO fields and summary (empty slots only), new entity pages get their approved copy;
//   5. the Recording is published through the EXISTING publish flow (publishRecordingDraft: completeness, locks, holds, audit). A refusal
//      (for example NOT_READY) leaves the bundle APPROVED with the reason and nothing public;
//   6. the VIDEO PAGE (modules/pipeline/videoPage.ts): when the video is PUBLIC and OBSERVED with no video hold, no Recording hold and no planner
//      hold (and PIPELINE_APPROVE_PUBLIC_VIDEO_PAGE is on), its page is published through the existing page-publication service INSIDE the
//      Recording's publish transaction, with the approving editor as actor and the reason "approved with pipeline bundle": both go live or
//      neither does. Unlisted and private videos are left exactly as they are (an unlisted page keeps its own decision in the unlisted review).
// Bulk approve: only bundles with NO flags. Reject: the bundle and its claims are rejected; nothing is created.

import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { planVideo, type VideoCreatePlan } from "../jobs/videoCreditsCreate";
import type { ExecuteReport } from "../jobs/videoCreditsCreateExecute";
import { toVideoFacts } from "./facts";
import { draftBundle, type BundleDraft, type PipelineVideoRow } from "./run";
import type { DraftClaim, PageDraft } from "./drafts";
import type { Resolution } from "./resolve";
import { findBannedPhrases } from "../mmke/guardrails/generation";
import { PIPELINE_VIDEO_PAGE_REASON, planVideoPage, type VideoPageFacts, type VideoPagePlan } from "./videoPage";

export interface BundleForApproval {
  id: string;
  status: string;
  flags: string[];
  youtubeVideoRowId: string;
  youtubeVideoId: string;
  youtubeTitle: string | null;
  description: string | null;
  publishedAt: string | null;
  extraction: { checked: CheckedVideoCredits; titleOnly: boolean; model: string };
  resolution: Resolution;
  draft: BundleDraft;
  claims: Array<DraftClaim & { dbId: string }>;
}

export interface ApprovalEdits {
  seoTitle?: string;
  metaDescription?: string;
  summary?: string;
  /** dbId -> decision. */
  claimDecisions?: Record<string, "accept" | "reject">;
  note?: string;
}

export interface ApprovalDeps {
  loadBundle(id: string): Promise<BundleForApproval | null>;
  executePlans(plans: VideoCreatePlan[], actorId: string): Promise<ExecuteReport>;
  findRecordingForVideo(youtubeVideoRowId: string): Promise<{ recordingId: string } | null>;
  linkContributorsAndPeople(input: { recordingId: string; actorId: string; checked: CheckedVideoCredits; resolution: Resolution }): Promise<string[]>;
  fillRecordingSeo(input: { recordingId: string; actorId: string; seoTitle: string; metaDescription: string; summary: string }): Promise<string>;
  publishEntityCopies(input: { actorId: string; pages: PageDraft[]; claimDbIds: string[] }): Promise<string[]>;
  decideClaims(input: { pipelineVideoId: string; accepted: string[]; rejected: string[]; actorId: string; at: Date }): Promise<void>;
  /** The video page's current state, for the video-page rule. */
  loadVideoPageFacts(youtubeVideoRowId: string): Promise<Omit<VideoPageFacts, "plannerHeld">>;
  /**
   * Publishes the Recording (publishRecordingDraft) and, when `videoPage` is given, the video page in the SAME transaction (rolled back together).
   */
  publish(input: { recordingId: string; actorId: string; videoPage: { youtubeVideoRowId: string; createPage: boolean; reason: string } | null }): Promise<{ ok: true } | { ok: false; reason: string; missingCategories?: string[]; detail?: string }>;
  markDecision(id: string, patch: { status: "APPROVED" | "PUBLISHED" | "REJECTED"; decidedById: string; decidedAt: Date; decisionNote: string | null; recordingId?: string | null; draft?: BundleDraft }): Promise<void>;
  audit(entry: { actorId: string; action: string; entityId: string; afterSnapshot: Record<string, unknown> }): Promise<void>;
  listPublishedCopySummaries(): Promise<Array<{ id: string; summary: string; name: string }>>;
}

export type ApprovalResult =
  | { ok: true; status: "PUBLISHED" | "APPROVED"; recordingId: string | null; notes: string[]; videoPage: { outcome: "PUBLISHED" | "ALREADY_LIVE" | "LEFT" | "NOT_PUBLISHED"; reason: string } }
  | { ok: false; reason: "NOT_FOUND" | "NOT_AWAITING" | "CONFLICTS_UNDECIDED" | "HELD" | "FLAGGED_FOR_BULK" | "EDIT_REFUSED"; detail: string[] };

export const canBulkApprove = (b: { status: string; flags: readonly string[] }) => b.status === "AWAITING_APPROVAL" && b.flags.length === 0;

/** Claims as decided by the owner: CONFLICT claims need an explicit decision; the rest are accepted unless rejected. */
export function applyClaimDecisions(claims: BundleForApproval["claims"], decisions: Record<string, "accept" | "reject"> = {}): { claims: BundleForApproval["claims"]; undecidedConflicts: string[] } {
  const undecidedConflicts = claims.filter((c) => c.status === "CONFLICT" && !decisions[c.dbId]).map((c) => c.id);
  const decided = claims.map((c) => {
    const d = decisions[c.dbId];
    if (c.status === "REJECTED" || c.status === "STALE") return c;
    if (d === "reject") return { ...c, status: "REJECTED" as const };
    // An accepted CONFLICT claim is recorded as accepted, but drafts never state a claim that conflicts with the video (videoRelation CONFLICTS).
    return { ...c, status: "ACCEPTED" as const };
  });
  return { claims: decided, undecidedConflicts };
}

/** What approving this bundle would put live (shown on the bundle page before the Approve button). */
export function videoPagePlanFor(bundle: Pick<BundleForApproval, "draft">, facts: Omit<VideoPageFacts, "plannerHeld">, enabled: boolean): VideoPagePlan {
  return planVideoPage({ ...facts, plannerHeld: bundle.draft.heldReasons.length > 0 }, { enabled });
}

export async function approveBundle(input: { id: string; actorId: string; edits?: ApprovalEdits; bulk?: boolean; now: Date; approvePublicVideoPage?: boolean }, deps: ApprovalDeps): Promise<ApprovalResult> {
  const bundle = await deps.loadBundle(input.id);
  if (!bundle) return { ok: false, reason: "NOT_FOUND", detail: [] };
  if (bundle.status !== "AWAITING_APPROVAL" && bundle.status !== "APPROVED") return { ok: false, reason: "NOT_AWAITING", detail: [`the bundle is ${bundle.status}`] };
  if (input.bulk && !canBulkApprove(bundle)) return { ok: false, reason: "FLAGGED_FOR_BULK", detail: bundle.flags };
  const edits = input.edits ?? {};
  for (const [field, text] of [["SEO title", edits.seoTitle], ["meta description", edits.metaDescription], ["summary", edits.summary]] as const) {
    const banned = text ? findBannedPhrases(text) : [];
    if (banned.length) return { ok: false, reason: "EDIT_REFUSED", detail: [`${field} uses banned wording: ${banned.join(", ")}`] };
  }

  const { claims, undecidedConflicts } = applyClaimDecisions(bundle.claims, edits.claimDecisions);
  if (undecidedConflicts.length) return { ok: false, reason: "CONFLICTS_UNDECIDED", detail: undecidedConflicts.map((id) => `${id} conflicts with the video: accept or reject it explicitly`) };

  const facts = toVideoFacts({ youtubeVideoId: bundle.youtubeVideoId, youtubeTitle: bundle.youtubeTitle ?? "", checked: bundle.extraction.checked, resolution: bundle.resolution });
  const plan = planVideo(facts);
  if (plan.heldReasons.length) return { ok: false, reason: "HELD", detail: plan.heldReasons };

  // Re-draft with the decided claims only, then the owner's own words on top.
  const row: PipelineVideoRow = { id: bundle.id, youtubeVideoId: bundle.youtubeVideoId, title: bundle.youtubeTitle, description: bundle.description, publishedAt: bundle.publishedAt, privacyStatus: "public", observabilityState: "OBSERVED", status: "RESEARCHED", attempts: 0, extraction: bundle.extraction, resolution: bundle.resolution };
  const redrafted = (await draftBundle(row, bundle.extraction, bundle.resolution, claims, [], await deps.listPublishedCopySummaries())).draft;
  const video = { ...redrafted.video, ...(edits.seoTitle ? { seoTitle: edits.seoTitle.trim() } : {}), ...(edits.metaDescription ? { metaDescription: edits.metaDescription.trim() } : {}), ...(edits.summary ? { summary: [edits.summary.trim()] } : {}) };
  const draft: BundleDraft = { ...redrafted, video, entities: redrafted.entities.map((e) => ({ ...e, searchQueries: bundle.draft.entities.find((x) => x.subjectKey === e.subjectKey)?.searchQueries ?? [] })) };

  await deps.decideClaims({ pipelineVideoId: bundle.id, accepted: claims.filter((c) => c.status === "ACCEPTED").map((c) => c.dbId), rejected: claims.filter((c) => c.status === "REJECTED").map((c) => c.dbId), actorId: input.actorId, at: input.now });

  const notes: string[] = [];
  const executed = await deps.executePlans([plan], input.actorId);
  notes.push(...executed.steps.filter((s) => s.outcome === "SKIPPED" || s.outcome === "REPORTED").map((s) => `${s.entity}: ${s.detail ?? s.outcome}`));
  const recording = await deps.findRecordingForVideo(bundle.youtubeVideoRowId);
  if (!recording) {
    await deps.markDecision(bundle.id, { status: "APPROVED", decidedById: input.actorId, decidedAt: input.now, decisionNote: "approved, but no Recording could be created (see notes)", draft });
    return { ok: true, status: "APPROVED", recordingId: null, notes, videoPage: { outcome: "NOT_PUBLISHED", reason: "no Recording was created, so nothing was published" } };
  }
  notes.push(...(await deps.linkContributorsAndPeople({ recordingId: recording.recordingId, actorId: input.actorId, checked: bundle.extraction.checked, resolution: bundle.resolution })));
  notes.push(await deps.fillRecordingSeo({ recordingId: recording.recordingId, actorId: input.actorId, seoTitle: video.seoTitle, metaDescription: video.metaDescription, summary: video.summary.join(" ") }));
  notes.push(...(await deps.publishEntityCopies({ actorId: input.actorId, pages: draft.entities, claimDbIds: claims.filter((c) => c.status === "ACCEPTED").map((c) => c.dbId) })));

  // The video-page rule is decided now, on the current state; the publication re-checks it inside the transaction.
  const pagePlan = videoPagePlanFor(bundle, await deps.loadVideoPageFacts(bundle.youtubeVideoRowId), input.approvePublicVideoPage !== false);
  const published = await deps.publish({
    recordingId: recording.recordingId,
    actorId: input.actorId,
    videoPage: pagePlan.action === "PUBLISH" ? { youtubeVideoRowId: bundle.youtubeVideoRowId, createPage: pagePlan.createPage, reason: PIPELINE_VIDEO_PAGE_REASON } : null,
  });
  const status = published.ok ? "PUBLISHED" : "APPROVED";
  const videoPage: Extract<ApprovalResult, { ok: true }>["videoPage"] = !published.ok
    ? { outcome: "NOT_PUBLISHED", reason: "nothing was published (see the publication note)" }
    : pagePlan.action === "PUBLISH"
      ? { outcome: "PUBLISHED", reason: pagePlan.reason }
      : pagePlan.action === "ALREADY_LIVE"
        ? { outcome: "ALREADY_LIVE", reason: pagePlan.reason }
        : { outcome: "LEFT", reason: pagePlan.reason };
  const note = published.ok
    ? null
    : `approved; nothing was published: ${published.reason}${published.detail ? ` (${published.detail})` : ""}${published.missingCategories?.length ? ` (missing: ${published.missingCategories.join(", ")})` : ""}`;
  if (note) notes.push(note);
  notes.push(`video page: ${videoPage.outcome.toLowerCase().replace("_", " ")}: ${videoPage.reason}`);
  await deps.markDecision(bundle.id, { status, decidedById: input.actorId, decidedAt: input.now, decisionNote: edits.note?.trim() || note, recordingId: recording.recordingId, draft });
  await deps.audit({ actorId: input.actorId, action: input.bulk ? "PIPELINE_BUNDLE_BULK_APPROVED" : "PIPELINE_BUNDLE_APPROVED", entityId: bundle.id, afterSnapshot: { status, recordingId: recording.recordingId, videoPage: videoPage.outcome, acceptedClaims: claims.filter((c) => c.status === "ACCEPTED").length, rejectedClaims: claims.filter((c) => c.status === "REJECTED").length, edited: Object.keys(edits).filter((k) => k !== "claimDecisions") } });
  return { ok: true, status, recordingId: recording.recordingId, notes, videoPage };
}

export async function rejectBundle(input: { id: string; actorId: string; note: string; now: Date }, deps: Pick<ApprovalDeps, "loadBundle" | "decideClaims" | "markDecision" | "audit">): Promise<{ ok: boolean; reason?: string }> {
  const bundle = await deps.loadBundle(input.id);
  if (!bundle) return { ok: false, reason: "NOT_FOUND" };
  if (bundle.status !== "AWAITING_APPROVAL") return { ok: false, reason: `the bundle is ${bundle.status}` };
  await deps.decideClaims({ pipelineVideoId: bundle.id, accepted: [], rejected: bundle.claims.filter((c) => c.status !== "REJECTED").map((c) => c.dbId), actorId: input.actorId, at: input.now });
  await deps.markDecision(bundle.id, { status: "REJECTED", decidedById: input.actorId, decidedAt: input.now, decisionNote: input.note.trim() || null });
  await deps.audit({ actorId: input.actorId, action: "PIPELINE_BUNDLE_REJECTED", entityId: bundle.id, afterSnapshot: { note: input.note.trim().slice(0, 300) } });
  return { ok: true };
}
