import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isPlausibleSlug } from "../../../../../../modules/mmke/slug/isPlausibleSlug";
import { getCurrentStudioSession } from "../../../../../../modules/auth/authService";
import { can } from "../../../../../../modules/auth/policy";
import {
  checkContentSuggestionFreshness,
  findContentSuggestionById,
} from "../../../../../../modules/db/repositories/contentSuggestionRepository";
import { findRecordingById } from "../../../../../../modules/db/repositories/recordingRepository";
import { formatAuditTimestamp } from "../../../../../../modules/audit/auditDisplay";
import EntityActivity from "../../../../../../components/studio/EntityActivity";
import { applyToRecordingDraftAction, approveAction, rejectAction, requestChangesAction, submitForReviewAction } from "./actions";
import { findContentSuggestionApplication, getApplicableTargetField } from "../../../../../../modules/db/repositories/contentSuggestionApplicationRepository";
import { describeApplyRefusalForEditor } from "../../../../../../modules/mmke/contentIntelligence/applyContentSuggestionRefusal";
import type { ContentSuggestionEvidenceRef } from "../../../../../../modules/mmke/contentIntelligence/contentSuggestionEvidence";
import { decodeMessage } from "../../../../../../modules/studio/decodeMessage";

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
  // An id no row could have (a NUL byte, which PostgreSQL rejects as text, or an absurd length) is not found, not a database error. After the sign-in check, so a visitor who is not signed in is still sent to sign in.
  if (!isPlausibleSlug(id)) notFound();
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
  const canApply = can(session.user.role, "RECORDING_WRITE");
  const applicableField = getApplicableTargetField(suggestion);
  const application = suggestion.status === "APPROVED" ? await findContentSuggestionApplication(suggestion.id) : null;
  const evidenceRefs = (suggestion.evidenceRefs as unknown as ContentSuggestionEvidenceRef[] | null) ?? [];

  return (
    <div>
      <p>
        <Link href="/studio/content-suggestions">← Content Suggestions</Link>
      </p>
      <h1>{suggestion.suggestionType}</h1>
      {error && <p role="alert" className="studio-alert studio-alert--error">{decodeMessage(error)}</p>}

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
      <p style={{ color: "var(--mm-text-muted)" }}>The original proposal, exactly as generated. Never edited in place — an editor&apos;s revision is recorded separately below.</p>
      <pre className="studio-pre">{suggestion.proposedContent}</pre>

      <h2>Evidence ({evidenceRefs.length})</h2>
      {evidenceRefs.length === 0 ? (
        <p className="studio-empty">No evidence references were recorded for this suggestion.</p>
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
            <button type="submit" className="studio-button--primary">Approve</button>
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
            <button type="submit" className="studio-button--danger">Reject</button>
          </form>

          <form action={requestChangesAction.bind(null, suggestion.id)} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <h3>Request changes</h3>
            <label>
              What needs to change?
              <textarea name="reviewNote" rows={3} required style={{ display: "block", width: "100%" }} />
            </label>
            <button type="submit" className="studio-button--primary">Request changes</button>
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
              <pre className="studio-pre studio-pre--success">{suggestion.finalContent}</pre>
            </>
          )}
          {suggestion.status === "APPROVED" && (
            <section className="studio-panel">
              <h3>Apply to Recording draft</h3>
              {application ? (
                <p>
                  Applied to the Recording&apos;s draft revision on {formatAuditTimestamp(application.appliedAt)}
                  {application.actorName ? ` by ${application.actorName}` : ""}
                  {application.forkedDraft ? " (a draft was created from the published revision)" : ""}. It has not been published — review and publish the
                  draft through the normal Recording workflow.
                  {targetRecording && (
                    <>
                      {" "}
                      <Link href={`/studio/recordings/${targetRecording.id}/review`}>Review the draft →</Link>
                    </>
                  )}
                </p>
              ) : !applicableField ? (
                <p style={{ color: "var(--mm-text-muted)" }}>This suggestion does not target an editorial field that can be applied to a Recording.</p>
              ) : freshness !== "CURRENT" ? (
                <p role="alert" className="studio-alert studio-alert--error">
                  {freshness === "STALE"
                    ? describeApplyRefusalForEditor("CONTENT_SUGGESTION_STALE")
                    : describeApplyRefusalForEditor("FRESHNESS_UNKNOWN")}
                </p>
              ) : !targetRecording ? (
                <p style={{ color: "var(--mm-text-muted)" }}>The target Recording could not be found.</p>
              ) : !canApply ? (
                <p style={{ color: "var(--mm-text-muted)" }}>You do not have permission to edit this Recording&apos;s draft.</p>
              ) : (
                <>
                  <p>
                    This will apply the approved editorial content to the Recording&apos;s draft revision. It will not publish the Recording.
                    <br />
                    Field: <code>{applicableField}</code> — the {suggestion.finalContent !== null ? "editor's final content" : "original proposal"} replaces the
                    draft&apos;s current value for this field only.
                    {!targetRecording.currentDraftRevisionId && (
                      <>
                        <br />
                        The Recording has no open draft, so one will be created from its published revision (Works and media carried forward; the public page
                        stays live).
                      </>
                    )}
                  </p>
                  <form action={applyToRecordingDraftAction.bind(null, suggestion.id)}>
                    <button type="submit" className="studio-button--primary">Apply to Recording Draft</button>
                  </form>
                </>
              )}
            </section>
          )}
        </div>
      )}

      <EntityActivity entityType="ContentSuggestion" entityId={suggestion.id} role={session.user.role} />
    </div>
  );
}
