import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import {
  checkContentSuggestionFreshness,
  findContentSuggestionById,
} from "../../../../../../modules/db/repositories/contentSuggestionRepository";
import { findRecordingById } from "../../../../../../modules/db/repositories/recordingRepository";
import { formatAuditTimestamp } from "../../../../../../modules/audit/auditDisplay";
import EntityActivity from "../../../../../../components/studio/EntityActivity";
import { approveAction, rejectAction, requestChangesAction, submitForReviewAction } from "./actions";
import type { ContentSuggestionEvidenceRef } from "../../../../../../modules/mmke/contentIntelligence/contentSuggestionEvidence";

// Phase 6H-4 — the Content Suggestion detail/review view. Deliberately
// minimal (brief: "do not build a complete Content Intelligence dashboard
// yet") — shows exactly what a reviewer needs: the target, the generation
// request that produced it, the proposal itself, its evidence, current
// context freshness, and the review controls. Never renders or links to
// anything public.

function recordingLabel(recording: {
  slug: string;
  currentPublishedRevision: { title: string | null } | null;
  currentDraftRevision: { title: string | null } | null;
}): string {
  return recording.currentPublishedRevision?.title ?? recording.currentDraftRevision?.title ?? recording.slug;
}

const FRESHNESS_LABEL: Record<string, string> = {
  CURRENT: "Current — the canonical context has not changed since this was generated.",
  STALE: "Stale — the canonical context has changed since this was generated. Review carefully before approving.",
  UNKNOWN: "Unknown — freshness could not be determined (no context fingerprint recorded, or the target is no longer available).",
};

export default async function ContentSuggestionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getCurrentStudioSession();
  if (!session) redirect("/studio/signin");
  if (!can(session.user.role, "RECORDING_WRITE")) {
    return <p>You do not have permission to view Content Suggestions.</p>;
  }

  const { id } = await params;
  const { error } = await searchParams;

  const suggestion = await findContentSuggestionById(id);
  if (!suggestion) {
    notFound();
  }

  const [freshness, targetRecording] = await Promise.all([
    checkContentSuggestionFreshness(id),
    suggestion.targetEntityType === "RECORDING" ? findRecordingById(suggestion.targetEntityId) : Promise.resolve(null),
  ]);

  const canReview = can(session.user.role, "EDITORIAL_REVIEW");
  const evidenceRefs = (suggestion.evidenceRefs as unknown as ContentSuggestionEvidenceRef[] | null) ?? [];

  return (
    <div>
      <p>
        <Link href="/studio/content-suggestions">← Content Suggestions</Link>
      </p>
      <h1>{suggestion.suggestionType}</h1>
      {error && <p style={{ color: "#b00020" }}>{decodeURIComponent(error)}</p>}

      <p>
        Target: <strong>{suggestion.targetEntityType}</strong>
        {" — "}
        {targetRecording ? (
          <Link href={`/studio/recordings/${targetRecording.id}/preview`}>{recordingLabel(targetRecording)}</Link>
        ) : (
          <code>{suggestion.targetEntityId}</code>
        )}
        {suggestion.targetField && (
          <>
            <br />
            Target field: <code>{suggestion.targetField}</code>
          </>
        )}
        <br />
        Status: <strong>{suggestion.status}</strong>
        <br />
        Context freshness: <strong>{freshness}</strong> — {FRESHNESS_LABEL[freshness]}
        <br />
        Created: {formatAuditTimestamp(suggestion.createdAt)}
      </p>

      <h2>Generation</h2>
      <p>
        Requested by: {suggestion.generationRequest.requestedBy.name}
        <br />
        Generation status: {suggestion.generationRequest.status}
        <br />
        Provider / model / prompt version: {suggestion.generationRequest.provider ?? "—"} / {suggestion.generationRequest.model ?? "—"} /{" "}
        {suggestion.generationRequest.promptVersion ?? "—"}
        <br />
        Context fingerprint: <code>{suggestion.generationRequest.contextFingerprint ?? "none recorded"}</code>
      </p>

      <h2>Proposed content</h2>
      <p style={{ color: "#666" }}>The original proposal, exactly as generated. Never edited in place — an editor&apos;s revision is recorded separately below.</p>
      <pre style={{ whiteSpace: "pre-wrap", background: "#f7f7f7", padding: "1rem" }}>{suggestion.proposedContent}</pre>

      <h2>Evidence ({evidenceRefs.length})</h2>
      {evidenceRefs.length === 0 ? (
        <p>No evidence references were recorded for this suggestion.</p>
      ) : (
        <ul>
          {evidenceRefs.map((ref, index) => (
            <li key={index}>
              {ref.sourceType}: {ref.entityType} <code>{ref.entityId}</code> — field <code>{ref.field}</code>
            </li>
          ))}
        </ul>
      )}

      <h2>Editorial review</h2>
      {suggestion.status === "DRAFT_READY" && canReview && (
        <form action={submitForReviewAction.bind(null, suggestion.id)}>
          <button type="submit">Begin review</button>
        </form>
      )}

      {suggestion.status === "EDITOR_REVIEW" && canReview && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", maxWidth: "36rem" }}>
          <form action={approveAction.bind(null, suggestion.id)} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <h3>Approve</h3>
            <label>
              Final content (leave blank to accept the proposal as written)
              <textarea name="finalContent" rows={6} style={{ display: "block", width: "100%" }} />
            </label>
            <label>
              Note
              <input name="reviewNote" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Approve</button>
          </form>

          <form action={rejectAction.bind(null, suggestion.id)} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <h3>Reject</h3>
            <label>
              Reason
              <select name="reason" style={{ display: "block" }}>
                <option value="UNSUPPORTED">Unsupported by evidence</option>
                <option value="INCORRECT">Incorrect</option>
                <option value="DUPLICATE">Duplicate</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>
              Note
              <input name="reviewNote" style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Reject</button>
          </form>

          <form action={requestChangesAction.bind(null, suggestion.id)} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <h3>Request changes</h3>
            <label>
              What needs to change?
              <textarea name="reviewNote" rows={3} required style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit">Request changes</button>
          </form>
        </div>
      )}

      {(suggestion.status === "APPROVED" || suggestion.status === "REJECTED" || suggestion.status === "CHANGES_REQUESTED") && (
        <div>
          <p>
            Reviewed by: {suggestion.reviewedBy?.name ?? "—"} on {suggestion.reviewedAt ? formatAuditTimestamp(suggestion.reviewedAt) : "—"}
            <br />
            Decision: {suggestion.reviewDecision ?? "—"}
            {suggestion.reviewNote && (
              <>
                <br />
                Note: {suggestion.reviewNote}
              </>
            )}
          </p>
          {suggestion.finalContent && (
            <>
              <h3>Editor&apos;s final content</h3>
              <pre style={{ whiteSpace: "pre-wrap", background: "#f0f7f0", padding: "1rem" }}>{suggestion.finalContent}</pre>
            </>
          )}
          {suggestion.status === "APPROVED" && (
            <p style={{ color: "#666" }}>
              Approved content is not yet published anywhere — turning an approved suggestion into a public edit is a future, separate action.
            </p>
          )}
        </div>
      )}

      <EntityActivity entityType="ContentSuggestion" entityId={suggestion.id} role={session.user.role} />
    </div>
  );
}
