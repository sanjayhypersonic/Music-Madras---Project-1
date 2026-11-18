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
//      (for example NOT_READY) leaves the bundle APPROVED with the reason; video exposure approvals are NOT touched (their own workflow).
// Bulk approve: only bundles with NO flags. Reject: the bundle and its claims are rejected; nothing is created.

import type { CheckedVideoCredits } from "../ai/structuredOutput/validateVideoCreditsOutput";
import { planVideo, type VideoCreatePlan } from "../jobs/videoCreditsCreate";
import type { ExecuteReport } from "../jobs/videoCreditsCreateExecute";
import { toVideoFacts } from "./facts";
import { draftBundle, type BundleDraft, type PipelineVideoRow } from "./run";
import type { DraftClaim, PageDraft } from "./drafts";
import type { Resolution } from "./resolve";
import { findBannedPhrases } from "../mmke/guardrails/generation";

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
  publish(input: { recordingId: string; actorId: string }): Promise<{ ok: true } | { ok: false; reason: string; missingCategories?: string[] }>;
  markDecision(id: string, patch: { status: "APPROVED" | "PUBLISHED" | "REJECTED"; decidedById: string; decidedAt: Date; decisionNote: string | null; recordingId?: string | null; draft?: BundleDraft }): Promise<void>;
  audit(entry: { actorId: string; action: string; entityId: string; afterSnapshot: Record<string, unknown> }): Promise<void>;
  listPublishedCopySummaries(): Promise<Array<{ id: string; summary: string; name: string }>>;
}

export type ApprovalResult =
  | { ok: true; status: "PUBLISHED" | "APPROVED"; recordingId: string | null; notes: string[] }
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

export async function approveBundle(input: { id: string; actorId: string; edits?: ApprovalEdits; bulk?: boolean; now: Date }, deps: ApprovalDeps): Promise<ApprovalResult> {
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
    return { ok: true, status: "APPROVED", recordingId: null, notes };
  }
  notes.push(...(await deps.linkContributorsAndPeople({ recordingId: recording.recordingId, actorId: input.actorId, checked: bundle.extraction.checked, resolution: bundle.resolution })));
  notes.push(await deps.fillRecordingSeo({ recordingId: recording.recordingId, actorId: input.actorId, seoTitle: video.seoTitle, metaDescription: video.metaDescription, summary: video.summary.join(" ") }));
  notes.push(...(await deps.publishEntityCopies({ actorId: input.actorId, pages: draft.entities, claimDbIds: claims.filter((c) => c.status === "ACCEPTED").map((c) => c.dbId) })));

  const published = await deps.publish({ recordingId: recording.recordingId, actorId: input.actorId });
  const status = published.ok ? "PUBLISHED" : "APPROVED";
  const note = published.ok ? null : `approved; publication refused: ${published.reason}${published.missingCategories?.length ? ` (missing: ${published.missingCategories.join(", ")})` : ""}`;
  if (note) notes.push(note);
  await deps.markDecision(bundle.id, { status, decidedById: input.actorId, decidedAt: input.now, decisionNote: edits.note?.trim() || note, recordingId: recording.recordingId, draft });
  await deps.audit({ actorId: input.actorId, action: input.bulk ? "PIPELINE_BUNDLE_BULK_APPROVED" : "PIPELINE_BUNDLE_APPROVED", entityId: bundle.id, afterSnapshot: { status, recordingId: recording.recordingId, acceptedClaims: claims.filter((c) => c.status === "ACCEPTED").length, rejectedClaims: claims.filter((c) => c.status === "REJECTED").length, edited: Object.keys(edits).filter((k) => k !== "claimDecisions") } });
  return { ok: true, status, recordingId: recording.recordingId, notes };
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
